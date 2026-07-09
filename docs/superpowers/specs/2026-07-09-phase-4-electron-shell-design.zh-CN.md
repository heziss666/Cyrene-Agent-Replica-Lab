# Phase 4：Electron 三层骨架设计

## 目标

这一阶段把当前只能在终端运行的 Agent，接入一个最小 Electron 桌面应用。

完成后，项目会具备：

```text
Electron main 进程
Electron preload 安全桥
Electron renderer 页面
IPC 通信
桌面聊天界面
AgentEvent 事件日志展示
```

这不是完整 UI 阶段。它只负责打通桌面应用的三层结构。

---

## 为什么现在做 Electron

前面已经完成：

1. 最小 Agent loop。
2. OpenAI-compatible / DeepSeek 调用。
3. 工具注册和 function calling。
4. 结构化 AgentEvent 事件流。

事件流已经可以描述 Agent 运行过程，所以现在适合把它传给 renderer 显示。

如果没有事件流，Electron 页面只能等最终回答，看不到模型调用和工具调用过程。

---

## 三层结构

### main

main 是 Electron 的 Node.js 侧。

它负责：

```text
创建窗口
注册 IPC handler
读取 .env
加载模型配置
创建 ToolRegistry
调用 runToolAgent
把 AgentEvent 通过 IPC 发给 renderer
```

新增文件：

```text
src/main/app/main.ts
src/main/app/create-window.ts
src/main/app/register-chat-ipc.ts
```

---

### preload

preload 是 main 和 renderer 之间的安全桥。

它负责：

```text
使用 contextBridge 暴露 window.cyrene
把 renderer 的 chat 请求转成 ipcRenderer.invoke
监听 main 发来的 AgentEvent
不直接暴露 Node.js 能力给网页
```

新增文件：

```text
src/preload/index.ts
```

---

### renderer

renderer 是 Chromium 页面。

它负责：

```text
显示聊天界面
读取用户输入
调用 window.cyrene.chat.sendMessage(...)
显示用户消息
显示 Agent 最终回复
显示 AgentEvent 日志
```

新增文件：

```text
src/renderer/chat/index.html
src/renderer/chat/main.ts
src/renderer/chat/style.css
```

---

## IPC 设计

新增共享文件：

```text
src/shared/ipc-channels.ts
```

定义固定 channel：

```text
cyrene:chat:send-message
cyrene:chat:agent-event
```

为什么放在 shared？

因为 main、preload、renderer 都要知道同一组 channel 名称。

如果字符串散落在三个地方，后面很容易拼错。

---

## 数据流

用户在 renderer 输入一句话：

```text
renderer
  -> window.cyrene.chat.sendMessage(text)
  -> preload
  -> ipcRenderer.invoke("cyrene:chat:send-message", text)
  -> main ipcMain.handle(...)
  -> runToolAgent(...)
  -> onEvent(event)
  -> window.webContents.send("cyrene:chat:agent-event", event)
  -> preload 转发给 renderer callback
  -> renderer 显示事件
  -> runToolAgent 返回最终回答
  -> IPC invoke 返回给 renderer
  -> renderer 显示 Agent 回复
```

---

## 本阶段不做什么

这一阶段暂时不做：

```text
复杂 UI
Markdown 渲染
真正 token streaming
RAG
记忆系统
Hook 系统
设置页面
多会话
消息持久化
Live2D
打包安装器
```

这些会在后续阶段逐步加入。

---

## 测试策略

Electron 窗口本身不容易在普通单元测试里完整验证，所以本阶段测试重点放在可测试边界：

1. IPC channel 常量是否稳定。
2. preload 暴露的 API 类型是否清晰。
3. main 里的 chat IPC handler 是否会调用 `runToolAgent` 并转发事件。
4. renderer 的纯逻辑函数是否能把事件转成页面文本。

手动验证重点：

```text
npm run dev:electron
窗口能打开
输入消息后页面能显示用户消息
如果模型调用工具，页面能显示事件日志
最终回答能显示在页面里
```

---

## 设计取舍

本阶段采用最小 Electron + Vite，而不是一次性复刻源项目复杂 UI。

原因：

1. 你现在最需要理解 Electron 三层通信。
2. 现有 Agent 仍然在 main 里运行，符合 Electron 安全模型。
3. renderer 不直接接触 API key。
4. AgentEvent 先用简单日志展示，后面再升级成更漂亮的时间线 UI。

这个设计比源项目更小，但方向一致。

源项目的 `main/index.ts` 比较大，学习版会拆成：

```text
create-window.ts
register-chat-ipc.ts
main.ts
```

这样更容易读，也更容易测试。
