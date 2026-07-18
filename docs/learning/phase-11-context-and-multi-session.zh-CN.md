# Phase 11 学习文档：上下文管理与多会话持久化

## 1. 这一阶段解决了什么问题

之前的聊天记录只存在 Electron Main 进程的内存变量中：

- 软件关闭，聊天记录消失；
- 只有一个会话；
- 对话越长，发给模型的 `messages` 越大；
- 无法从很久以前的对话中找回相关细节。

现在系统把“本地完整聊天记录”和“本次发给模型的上下文”分开：

```text
完整聊天记录：长期保存在 JSON 文件中
本轮模型上下文：从完整记录中按预算临时选出来
```

因此，生成总结或裁减上下文不会删除原始聊天记录。

## 2. 一条消息的完整工作流

```text
Renderer 输入文字
    ↓
Preload 发送 conversationId、requestId、text
    ↓
register-chat-ipc.ts
    ↓
ConversationService 先把用户消息保存为 pending
    ↓
ContextManager 选择本轮上下文
    ↓
runToolAgent 执行模型和工具循环
    ↓
ConversationService 保存 assistant/tool 消息
    ↓
用户消息从 pending 变成 complete
    ↓
后台更新会话总结和历史向量
```

先保存用户问题再调用模型，是为了防止模型仍在生成时软件退出。如果启动时看到 `pending`，就知道上一次回答中断了。

## 3. 数据保存在哪里

Electron 使用 `app.getPath("userData")` 得到应用数据目录，结构为：

```text
userData/
└─ conversations/
   ├─ index.json
   ├─ sessions/
   │  ├─ conv_xxx.json
   │  └─ conv_yyy.json
   ├─ conversation-vector-index.json
   └─ corrupt/
```

### `sessions/conv_xxx.json`

这是事实源，保存完整消息、人格、固定消息和总结。一个会话一个文件，修改 A 不需要重写 B。

### `index.json`

这是会话列表缓存，只保存标题、预览、更新时间和当前会话 ID。它损坏或丢失时，可以扫描 `sessions` 重建。

### `conversation-vector-index.json`

这是旧消息的向量。它只保存块 ID、正文哈希和数字向量，不保存唯一的聊天事实，因此可以重建。

## 4. 主要代码文件

### 会话数据与存储

- `src/main/conversations/conversation-types.ts`：规定持久化 JSON 的 TypeScript 结构。
- `src/main/conversations/conversation-migrations.ts`：使用 Zod 验证文件格式和版本。
- `src/main/conversations/conversation-store.ts`：原子读写会话文件、重建索引、隔离坏文件。
- `src/main/conversations/conversation-service.ts`：实现新建、切换、删除、消息状态、人格和固定消息规则。
- `src/main/conversations/conversation-title.ts`：根据第一条问题生成本地标题。

`ConversationStore` 关心“文件怎么保存”，`ConversationService` 关心“业务上允许怎么操作”。

### 上下文管理

- `src/main/context/token-estimator.ts`：保守估算文字、消息和工具 Schema 的 Token。
- `src/main/context/conversation-turns.ts`：把工具调用链作为不可拆分的完整轮次。
- `src/main/context/context-manager.ts`：按优先级组装最终 `messages`。
- `src/main/context/conversation-summarizer.ts`：增量生成结构化会话总结。
- `src/main/context/conversation-history-retriever.ts`：切块、向量检索、关键词检索和降级。
- `src/main/context/conversation-vector-index.ts`：按 `conversationId` 隔离旧消息向量。

### Electron 通信和界面

- `src/main/app/register-conversation-ipc.ts`：会话管理 IPC Handler。
- `src/main/app/register-chat-ipc.ts`：聊天请求、Agent Loop、记忆写入和会话提交的协调者。
- `src/preload/index.ts`：向 Renderer 暴露受控的 `window.cyrene.conversations`。
- `src/renderer/chat/conversation-view.ts`：会话侧栏 DOM。
- `src/renderer/chat/conversation-view-model.ts`：防止异步结果显示到错误会话。
- `src/renderer/chat/main.ts`：把侧栏、聊天、人格和 IPC 串起来。

## 5. 持久化消息为什么不直接使用 ChatMessage

模型只需要：

```ts
{ role: "user", content: "解释 ContextManager" }
```

本地系统还需要：

```ts
{
  id: "msg_123",
  conversationId: "conv_1",
  requestId: "request_8",
  role: "user",
  content: "解释 ContextManager",
  createdAt: "2026-07-18T10:00:00.000Z",
  tokenEstimate: 6,
  status: "pending"
}
```

因此，持久化层使用 `ConversationMessage`，模型调用前再转换成 `ChatMessage`。这样不会把本地存储字段污染供应商接口。

## 6. Token 预算怎么算

默认配置：

```text
模型总窗口                32768
预留模型回答               4096
预留 Agent 工具增长         8192
剩余首次请求预算           20480
```

还要从 20480 中扣除工具 Schema。剩余部分才用于 System 和聊天内容。

上下文优先级为：

```text
当前问题
System Prompt
固定消息
最近完整轮次
会话总结
检索旧消息
```

如果固定消息本身已经超过窗口，系统抛出：

```text
CONVERSATION_PINNED_CONTENT_EXCEEDS_BUDGET
```

它不会偷偷删除用户明确固定的内容。

## 7. 为什么工具消息不能随便截断

一次工具轮次可能是：

```text
user
assistant(toolCalls=[call_1])
tool(toolCallId=call_1)
assistant 最终回答
```

如果只保留 `tool`，供应商会发现它没有对应的 `assistant.toolCalls`；如果只保留调用，没有结果，模型也无法理解发生了什么。

`conversation-turns.ts` 把它们当成一个整体：要么整轮进入，要么整轮不进入。

## 8. 会话总结如何更新

假设消息 1 到 20 已经总结，之后又产生消息 21 到 40：

```text
旧结构化总结 + 消息 21～某个旧轮次
                ↓
            新结构化总结
```

最近的完整轮次受到保护，不会刚说完就被总结。总结包含：

- 会话概况；
- 已作决定；
- 约束；
- 用户请求；
- 未完成任务；
- 重要工具结果；
- 主要实体。

`coveredThroughMessageId` 记录总结覆盖到哪里。模型请求失败或 JSON 验证失败时，保留旧总结和旧游标。

## 9. 旧消息检索如何工作

检索单位是完整问答轮次，而不是单独一句：

```text
User: ToolRegistry 在哪里注册？
Tools used: search_knowledge
Assistant: ToolRegistry 在运行时保存和执行工具。
```

原始工具输出不会默认进入 Embedding 文本，以免把长日志或敏感数据送进索引。

检索同时使用：

1. Ollama 向量检索：寻找语义相近内容；
2. 关键词检索：寻找文件名、类名、ID 和错误码；
3. 排名融合：合并两组排名；
4. 去重：排除最近窗口和固定消息中已经存在的轮次；
5. 会话过滤：只查询当前 `conversationId`。

Ollama 不可用时，返回 `mode: "keyword"`，聊天仍可继续。

## 10. 多会话如何防止串消息

发送请求时带两个 ID：

```ts
{
  conversationId: "conv_a",
  requestId: "request_123",
  text: "解释向量索引"
}
```

如果用户发送后切换到 B，A 的回答返回时：

- Main 把回答保存到 A；
- 返回结果仍带 `conversationId: "conv_a"`；
- Renderer ViewModel 发现当前是 B，不把回答插入 B；
- A 在会话列表显示未读状态；
- 切回 A 时从持久化文件重新加载。

## 11. ContextManager 的 Python 伪代码

```python
def build_context(record, system_prompt, tools, request_id):
    current = find_pending_user_message(record, request_id)

    input_budget = (
        context_window
        - output_reserve
        - tool_growth_reserve
    )
    message_budget = input_budget - estimate_tools(tools)

    system_sections = [system_prompt]

    pinned = find_pinned_messages(record)
    if pinned:
        system_sections.append(render_pinned_as_background(pinned))

    if estimate(system_sections, current) > message_budget:
        raise PinnedContentExceedsBudget()

    recent_turns = select_recent_complete_turns(record, message_budget)

    if summary_fits(record.summary):
        system_sections.append(render_summary(record.summary))

    old_results = history_retriever.retrieve(
        conversation_id=record.id,
        query=current.content,
        exclude=ids_from(recent_turns) | set(record.pinned_ids),
    )

    for result in old_results:
        if result_fits(result):
            system_sections.append(render_as_untrusted_history(result))

    return [
        {"role": "system", "content": join(system_sections)},
        *to_model_messages(recent_turns),
        {"role": "user", "content": current.content},
    ]
```

## 12. 如何测试

自动测试：

```cmd
npm test
npm run typecheck
npm run build
npm run test:electron-smoke
```

手动测试：

1. 运行 `npm run dev:electron`；
2. 在会话 A 发送几条消息；
3. 新建会话 B，并选择不同人格；
4. 在 A 和 B 之间切换，确认消息和人格不同；
5. 关闭并重新打开 Electron，确认会话恢复；
6. 停止 Ollama，确认聊天仍能运行；
7. 恢复 Ollama，继续对话并观察后台索引。

## 13. 当前保留的兼容代码

`register-chat-ipc.ts` 暂时仍接受旧版纯字符串 payload，旧的 `ChatSession` 测试也保留，用于保证历史行为不突然失效。Electron Renderer 已完全使用新的结构化多会话接口，真实应用运行时的数据来源是 `ConversationService` 和 JSON Store。
