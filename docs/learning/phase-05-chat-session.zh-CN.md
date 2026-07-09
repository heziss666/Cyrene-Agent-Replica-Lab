# Phase 05：桌面聊天会话系统

这一阶段解决一个很关键的问题：

> 桌面版 Electron 聊天不应该每次发送都重新开始，而应该保存当前会话的 messages 历史。

---

## 1. 为什么需要 Session

大模型本身不会自动记住你前面说过什么。

它每次能看到什么，取决于程序这次请求 API 时传了哪些 `messages`。

如果第一次发送：

```text
你好，我叫小明
```

第二次发送：

```text
我叫什么？
```

如果第二次请求模型时只传：

```ts
[
  { role: "system", content: "..." },
  { role: "user", content: "我叫什么？" }
]
```

模型大概率不知道你叫小明。

如果第二次请求模型时传：

```ts
[
  { role: "system", content: "..." },
  { role: "user", content: "你好，我叫小明" },
  { role: "assistant", content: "你好，小明。" },
  { role: "user", content: "我叫什么？" }
]
```

模型才能根据上下文回答。

所以多轮聊天的本质是：

```text
程序保存 messages 历史
每次请求模型时带上历史
```

---

## 2. Session 和 Run 的区别

### Session

Session 是一个聊天会话。

它保存一段连续对话的上下文。

比如：

```text
Session A
  用户：你好
  Agent：你好
  用户：帮我算 2+2
  Agent：结果是 4
```

Session 关注的是：

```text
这一整段聊天历史是什么
```

---

### Run

Run 是一次用户发送消息后，Agent 执行的一轮过程。

比如在同一个 Session 里：

```text
run_1：用户发送“你好”
run_2：用户发送“帮我算 2+2”
run_3：用户发送“总结一下刚才”
```

Run 关注的是：

```text
这一次发送消息时，Agent 做了哪些步骤
```

所以：

```text
一个 Session 可以包含多个 Run
一个 Run 属于某个 Session
```

---

## 3. 新增文件：chat-session.ts

文件：

```text
src/main/chat/chat-session.ts
```

它只负责保存 messages。

它不懂 Electron，也不调用模型。

核心能力：

```ts
session.getMessages()
session.appendUserMessage(text)
session.replaceMessages(messages)
session.clear()
```

你可以把它理解成 Python 里的：

```python
class ChatSession:
    def __init__(self, initial_messages):
        self.initial_messages = copy(initial_messages)
        self.messages = copy(initial_messages)

    def append_user_message(self, text):
        self.messages.append({"role": "user", "content": text})
        return copy(self.messages)

    def replace_messages(self, messages):
        self.messages = copy(messages)

    def clear(self):
        self.messages = copy(self.initial_messages)
```

---

## 4. 为什么 ChatSession 在 main 里

因为当前桌面聊天的真实 Agent 调用发生在 main 进程。

main 负责：

```text
读取 .env
调用模型
执行工具
保存当前会话上下文
```

renderer 只负责显示页面。

如果 renderer 自己保存 messages，main 每次还要信任 renderer 传来的完整历史，这不利于后续做权限、工具限制、记忆注入和持久化。

所以现在的设计是：

```text
renderer 保存 UI 显示状态
main 保存 Agent 真正使用的 messages 状态
```

---

## 5. register-chat-ipc.ts 发生了什么变化

以前每次发送时会重新拼：

```ts
const messages = [...getInitialHistory(), createUserMessage(text)];
```

这意味着每次都是单轮。

现在变成：

```ts
const messages = session.appendUserMessage(text);
const result = await runAgent({ messages, ... });
session.replaceMessages(result.messages);
```

意思是：

```text
1. 从 session 里拿历史
2. 追加当前 user 消息
3. 调用 Agent
4. Agent 返回更新后的 messages
5. 把 result.messages 写回 session
```

这样下一次发送时，session 里就已经有前面的 user / assistant / tool 消息。

---

## 6. runId 是什么

每次用户发送消息，main 会创建一个 runId：

```text
run_1
run_2
run_3
```

Agent 运行过程中会产生事件。

现在事件通过 IPC 发给 renderer 时会包一层：

```ts
{
  runId: "run_2",
  event: {
    type: "tool_call_started",
    ...
  }
}
```

这样右侧事件日志能知道：

```text
这个事件属于哪一次发送
```

---

## 7. New Chat 做了什么

renderer 里新增了 New Chat 按钮。

点击后：

```text
renderer
  -> window.cyrene.chat.clearSession()
  -> preload
  -> ipcRenderer.invoke("cyrene:chat:clear-session")
  -> main
  -> session.clear()
  -> renderer 清空页面消息和事件
```

注意：

```text
清空 UI 不等于清空 Agent 上下文
```

所以必须同时做两件事：

```text
main 清空 ChatSession
renderer 清空页面显示
```

---

## 8. 现在的 IPC channel

当前聊天相关 channel 有三个：

```text
cyrene:chat:send-message
```

renderer 请求 main 发送一条用户消息，并等待最终回复。

```text
cyrene:chat:agent-event
```

main 在 Agent 运行过程中主动推送事件给 renderer。

```text
cyrene:chat:clear-session
```

renderer 请求 main 清空当前会话。

---

## 9. 本阶段没有做长期记忆

这一阶段的 Session 只是短期上下文。

它和后面的长期记忆不同。

短期上下文：

```text
当前窗口里这一段对话
存在内存中
关闭应用后可以丢失
```

长期记忆：

```text
用户画像、重要事实、事件记忆
需要判断是否值得保存
可能写入 JSON / 数据库 / RAG
关闭应用后仍然存在
```

所以 Phase 5 是长期记忆的前置基础，但不是长期记忆本身。

---

## 10. 你应该理解什么

读完本阶段，你应该能解释：

1. 多轮对话为什么必须保存 messages。
2. Session 和 Run 有什么区别。
3. ChatSession 为什么放在 main。
4. result.messages 为什么要写回 session。
5. clear session 为什么要同时清 main 状态和 renderer UI。
6. runId 为什么能帮助事件日志归属。
7. 短期上下文和长期记忆不是一回事。
