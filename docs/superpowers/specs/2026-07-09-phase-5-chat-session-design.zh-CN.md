# Phase 5：桌面聊天会话系统设计

## 目标

Phase 5 的目标是把 Electron 桌面版从“单次请求”升级成“真正的多轮聊天会话”。

当前 Phase 4 已经完成：

```text
renderer 输入消息
preload 转发 IPC
main 调用 runToolAgent
AgentEvent 回传 renderer
最终 reply 显示在页面
```

但当前桌面版还有一个重要限制：

```text
每次发送消息时，main 都重新创建 messages
```

这意味着桌面版现在还不是完整多轮聊天。模型不能自然看到前几轮桌面聊天上下文。

Phase 5 要补上的就是：

```text
一个 Electron 桌面会话内的 messages 历史
一次发送消息对应一次 run
每次 run 的事件可以归属到对应 runId
用户可以清空当前会话
```

---

## 核心概念

### Session

Session 表示一个聊天会话。

它保存：

```text
sessionId
messages
createdAt
updatedAt
```

其中 `messages` 是模型真正看到的上下文。

如果用户连续发送两条消息：

```text
你好
你还记得我刚才说了什么吗？
```

第二次调用模型时，messages 里必须包含第一轮的 user / assistant 消息。

---

### Run

Run 表示一次用户发送。

比如用户在同一个 Session 里发了三次消息，就有三次 Run：

```text
session
  run 1: 用户发“你好”
  run 2: 用户发“帮我算 2+2”
  run 3: 用户发“总结一下”
```

Run 不等于 Session。

Session 是长期一点的聊天上下文。

Run 是一次具体执行过程。

---

### AgentEvent 和 runId

Phase 3 已经有 `AgentEvent`。

Phase 5 要让 Electron 侧发送事件时带上 `runId`：

```ts
{
  runId: "run_...",
  event: AgentEvent
}
```

这样 renderer 能知道：

```text
这个事件属于哪一次发送
```

当前阶段不强制修改 AgentEvent 本身，而是在 Electron IPC 层包一层 `ChatAgentEventPayload`。

这样可以减少对 Agent 核心 loop 的侵入。

---

## 文件设计

### 新增：src/main/chat/chat-session.ts

负责管理单个会话。

它应该提供：

```ts
createChatSession()
session.getMessages()
session.appendUserMessage(text)
session.replaceMessages(messages)
session.clear()
```

它不调用模型，也不懂 Electron。

它只负责 messages 历史。

---

### 修改：src/main/app/register-chat-ipc.ts

当前它每次都这样创建 messages：

```ts
const messages = [...getInitialHistory(), createUserMessage(text)];
```

Phase 5 后改为：

```text
从 ChatSession 取历史
追加 user message
调用 runToolAgent
用 result.messages 更新 session
返回 reply / runId / messageCount
```

它还要新增 clear session IPC：

```text
cyrene:chat:clear-session
```

---

### 修改：src/shared/ipc-channels.ts

新增 channel：

```text
cyrene:chat:clear-session
```

保留：

```text
cyrene:chat:send-message
cyrene:chat:agent-event
```

---

### 修改：src/shared/electron-api.ts

扩展 renderer 能看到的 API 类型：

```ts
sendMessage(text): Promise<ChatSendResult>
clearSession(): Promise<ChatClearResult>
onAgentEvent(listener): () => void
```

`ChatSendResult` 应包含：

```ts
reply: string
runId: string
messageCount: number
toolResultCount: number
```

`ChatAgentEventPayload` 应包含：

```ts
runId: string
event: AgentEvent
```

---

### 修改：src/preload/index.ts

新增：

```ts
clearSession: () => ipcRenderer.invoke(IPC_CHANNELS.chat.clearSession)
```

并且 `onAgentEvent` 的 listener 接收 `ChatAgentEventPayload`。

---

### 修改：src/renderer/chat/*

renderer 需要支持：

```text
New Chat / Clear 按钮
发送中禁用输入
清空页面消息和事件
事件显示 runId 短标识
错误时仍显示在聊天区
```

当前阶段不做复杂 UI，只做可用、可读。

---

## 数据流

发送消息：

```text
renderer submit
  -> window.cyrene.chat.sendMessage(text)
  -> preload ipcRenderer.invoke("cyrene:chat:send-message", text)
  -> main register-chat-ipc
  -> session.appendUserMessage(text)
  -> runToolAgent({ messages: session.getMessages() })
  -> onEvent(agentEvent)
  -> sender.send("cyrene:chat:agent-event", { runId, event: agentEvent })
  -> result.messages 写回 session
  -> return { reply, runId, messageCount, toolResultCount }
  -> renderer 显示回复
```

清空会话：

```text
renderer click New Chat
  -> window.cyrene.chat.clearSession()
  -> preload invoke("cyrene:chat:clear-session")
  -> main session.clear()
  -> renderer 清空 messages 和 events
```

---

## 本阶段不做什么

Phase 5 暂时不做：

```text
持久化历史到磁盘
多会话列表
Stop/Abort
RAG
长期记忆
Markdown 渲染
真正 token streaming
消息编辑
附件上传
```

这些会在后续阶段继续加入。

---

## 测试策略

重点测试不依赖真实 Electron 窗口的部分：

```text
ChatSession 是否保留多轮 messages
clear 是否重置 session
registerChatIpc 连续调用两次时第二次带上历史
clear-session channel 是否会清空历史
agent-event payload 是否带 runId
renderer event formatter 是否能显示 runId
```

手动验证：

```text
npm run dev:electron
发送：你好
再发送：你还记得我刚才说了什么吗？
观察第二次回答是否能引用第一轮上下文
点击 New Chat
再问：你还记得我刚才说了什么吗？
观察会话是否被清空
```

---

## 设计取舍

本阶段只做内存会话，不做磁盘持久化。

原因：

```text
先理解 messages history 的运行机制
先把 Electron main 和 renderer 状态边界打清楚
后续再接 memory / RAG / 持久化会更自然
```

这也符合学习路线：

```text
先会话
再 RAG
再长期记忆
```

否则会把“短期上下文”和“长期记忆”混在一起，学习成本会明显增加。
