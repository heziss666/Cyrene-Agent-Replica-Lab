# Phase 12：可靠的流式 Agent 运行系统

## 1. 这一阶段解决什么问题

以前，Electron 前端发送消息后，会一直等待 Main 完成整轮 Agent Loop。模型慢、工具慢或网络异常时，界面只能显示“Running”，用户不知道程序进行到了哪里，也无法可靠停止。

Phase 12 把“一次 Agent 工作”变成独立的 **Run（运行记录）**。每个 Run 都有 ID、状态、事件序号、取消信号、Trace 和持久化记录。

现在可以做到：

- 模型生成一小段文本，界面立刻显示一小段；
- 用户点击方形停止按钮，只取消对应 Run；
- 不同会话最多并行运行两个 Agent；
- 同一会话仍然严格串行，避免消息顺序错乱；
- Chat 和 Scheduler 共用并发槽；
- 软件重启后仍能查看历史 Run；
- 部分回答会保留给用户看，但不会进入下一轮可信上下文；
- Trace 会过滤 API Key、Authorization、password 等敏感值。

## 2. 最通俗的结构

可以把系统想成一家有两个工位的维修店：

1. renderer 提交任务，Main 立即发回一个取件号 `runId`；
2. `AgentRunQueue` 决定任务什么时候占用工位；
3. `AgentRunManager` 管理任务从排队到结束的完整生命周期；
4. `runToolAgent` 真正执行模型调用、工具调用和多轮循环；
5. 每产生一段文本，Main 通过 IPC 推送给 renderer；
6. `AgentRunStore` 把安全 Trace 写入 JSON；
7. Runs 页面读取这些记录，用于观察和排错。

## 3. 完整调用链

```text
用户点击 Send
  -> preload: chat.sendMessage(...)
  -> IPC Channel: cyrene:chat:send-message
  -> register-chat-ipc.ts
  -> AgentRunManager.submit(...)
  -> 立即返回 { runId, status }

AgentRunQueue 获得空闲槽
  -> Manager 创建 AbortController
  -> register-chat-ipc.ts 组装 system/messages/tools
  -> runToolAgent({ stream: true, signal, onTextDelta })
  -> OpenAI-compatible SSE
  -> onTextDelta(delta)
  -> Manager.emit("text_delta", { delta })
  -> IPC Channel: cyrene:runs:event
  -> renderer 的 conversation-view-model
  -> 把 delta 追加到对应 runId 的消息
```

结束时：

```text
成功 -> completeRun() -> 消息状态 complete -> run_succeeded
取消 -> finishAssistantStream(..., "cancelled") -> run_cancelled
失败 -> 消息状态 failed -> run_failed
```

## 4. runs 目录怎么分工

### agent-run-types.ts

定义 Run 的“数据字典”：状态、来源、用量、错误、Trace 事件和持久化记录格式。

主要状态：`queued`、`running`、`succeeded`、`failed`、`cancelled`。

### agent-run-queue.ts

只负责排队规则：

- 全局最多两个 active Run；
- 同一 `conversationId` 同时最多一个 active Run；
- 队首因同会话锁被挡住时，可以寻找后面可执行的其他会话，避免无谓阻塞。

Python 思路：

```python
if active_count < 2 and conversation_id not in active_conversations:
    start(run)
else:
    waiting.append(run)
```

### agent-run-controller.ts

管理单个 Run：`AbortController`、严格递增的事件序号和终态保护。

序号用于防止 renderer 重复处理或乱序处理事件。例如已经处理 `sequence=8`，再次收到 8 或 7 就忽略。

### agent-run-manager.ts

它是总调度者，组合 Queue、Controller、Store 和 UsageCollector。

主要方法：

- `submit()`：创建并排队；
- `cancel()`：取消 queued 或 running Run；
- `wait()`：等待 Scheduler 使用的 Run 完成；
- `list()/get()`：读取记录；
- `beginShutdown()/flush()`：关机时停止接收并排空写入。

### agent-run-store.ts

把 Run 写入 `userData/agent-runs`。使用原子写入，程序突然退出时不容易留下半个 JSON。

保留策略：最多 1000 条，并删除超过 30 天的记录。损坏文件会移到 `corrupt`，不会偷偷覆盖。

### trace-sanitizer.ts

Trace 不是把所有运行变量原样写盘。它会：

- 隐藏敏感字段；
- 隐藏 Bearer Token；
- 限制对象深度、数组长度和文本预览长度；
- 避免工具返回巨量内容拖垮 Runs 页面。

### agent-run-error.ts

把任意异常转换为 renderer 可以安全显示的结构化错误。例如 HTTP 429 会变成可重试的 Provider 错误，AbortError 会变成 `RUN_CANCELLED`。

## 5. SSE 流式返回

普通 HTTP 返回要等整个 JSON 完成。SSE 会连续发送多帧：

```text
data: {"choices":[{"delta":{"content":"你"}}]}
data: {"choices":[{"delta":{"content":"好"}}]}
data: [DONE]
```

`sse-parser.ts` 解决 TCP 分块不等于 SSE 分帧的问题。一个 JSON 可能被拆成两次网络读取，也可能一次读取包含多帧。

`openai-compatible-stream.ts` 负责：

- 累积文本 delta；
- 拼接被拆开的 Tool Call id/name/arguments；
- 读取最终 usage；
- 在收到有效 delta 后禁止自动重试，避免重复文本或重复工具行为。

## 6. 为什么取消不是直接杀进程

JavaScript 使用 `AbortController`：

```python
# Python 近似概念
cancel_event = asyncio.Event()

if cancel_event.is_set():
    raise CancelledError()
```

Main 把同一个 `signal` 传给模型请求和工具执行上下文。Agent Loop 会在模型前、工具前、工具后和下一轮前检查取消。

已经交给外部 MCP 服务的副作用不一定能撤回，因此系统不会谎称“工具一定被杀死”；它只保证取消后不再启动后续模型轮次或新工具。

## 7. 会话中的部分回答

会话消息新增了 `streaming` 和 `cancelled` 状态。

- 第一段文本前创建一个稳定 assistant 消息 ID；
- 后续 delta 更新同一条消息；
- 最多约每秒做一次中间 checkpoint；
- 成功时用完整 Agent transcript 替换占位消息；
- 取消时保留部分文本并改为 `cancelled`；
- 启动时发现上次遗留的 pending/streaming，会恢复为 failed。

`toChatMessages()` 只接受 `complete`，因此部分回答不会进入上下文、摘要、历史向量检索或记忆判断。

## 8. IPC 与 preload

renderer 没有拿到 `ipcRenderer`，只拿到 preload 暴露的白名单：

```ts
window.cyrene.runs.list()
window.cyrene.runs.get(runId)
window.cyrene.runs.cancel(runId)
window.cyrene.runs.onEvent(listener)
```

导出时 renderer 只提供 `runId`，文件路径由 Main 的系统保存对话框选择，避免 renderer 借导出功能任意写文件。

## 9. Runs 页面

Runs 标签页支持：

- 按 Chat/Scheduler 来源筛选；
- 按状态筛选；
- 搜索 runId、conversationId、taskId 和错误码；
- 查看 Token 用量与来源；
- 按 sequence 查看 Trace；
- 停止、导出、删除单条记录或清空历史。

## 10. 如何测试

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:streaming
npm.cmd run test:electron-smoke
```

手动测试：启动 `npm.cmd run dev:electron`，发送一个要求较长回答的问题；观察文字逐步出现，点击停止后应保留部分回答。打开 Runs，检查状态、Trace 和导出。

## 11. 配置项

可在本地 `.env` 中配置：

```dotenv
CYRENE_AGENT_MAX_CONCURRENT_RUNS=2
CYRENE_AGENT_RUN_TIMEOUT_MS=600000
```

这些值必须是正整数。API Key 仍然只能保存在本地 `.env`，不能提交到 Git。
