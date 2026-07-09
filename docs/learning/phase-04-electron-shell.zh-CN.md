# Phase 04：Electron 三层骨架

这一阶段把终端 Agent 接进了一个最小桌面应用。

你可以把 Electron 应用理解成：

```text
Node.js 后端能力 + Chromium 网页界面
```

但 Electron 不建议让网页直接使用 Node.js。  
所以它通常拆成三层：

```text
main     Node.js 侧，负责窗口、文件、系统能力、Agent 调用
preload  安全桥，负责把少量 API 暴露给网页
renderer Chromium 网页，负责显示界面和处理点击输入
```

---

## 1. 本阶段新增了什么

主要新增文件：

```text
src/main/app/main.ts
src/main/app/create-window.ts
src/main/app/register-chat-ipc.ts
src/preload/index.ts
src/renderer/chat/index.html
src/renderer/chat/main.ts
src/renderer/chat/style.css
src/renderer/chat/renderer-events.ts
src/shared/ipc-channels.ts
src/shared/electron-api.ts
```

新增命令：

```text
npm run build
npm run build:electron
npm run build:renderer
npm run dev:electron
```

---

## 2. main 是什么

main 是 Electron 的主进程。

它运行在 Node.js 环境里，所以可以：

```text
读取 .env
使用 API key
调用模型
执行工具
创建窗口
注册 IPC
```

入口文件：

```text
src/main/app/main.ts
```

它做了两件核心事情：

```ts
registerChatIpc({ ipcMain });
await createMainWindow();
```

也就是：

1. 注册聊天 IPC。
2. 创建桌面窗口。

---

## 3. create-window.ts 做什么

文件：

```text
src/main/app/create-window.ts
```

它负责创建 `BrowserWindow`：

```ts
const window = new BrowserWindow({
  webPreferences: {
    preload: getPreloadPath(),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  },
});
```

重点是这几个配置：

```text
preload
```

告诉 Electron：窗口加载网页前，先加载哪个 preload 脚本。

```text
contextIsolation: true
```

让网页 JS 和 preload JS 隔离，安全性更好。

```text
nodeIntegration: false
```

不允许网页直接 `import fs`、`import path` 或访问 Node.js。

这意味着 renderer 不能直接碰 API key，也不能直接调用本地文件系统。

---

## 4. preload 是什么

文件：

```text
src/preload/index.ts
```

它用 `contextBridge` 暴露了一个很小的 API：

```ts
window.cyrene.chat.sendMessage(text)
window.cyrene.chat.onAgentEvent(listener)
```

preload 就像 Python 里一个“受限制的门面对象”。

网页不能随便调用 Node.js，只能调用我们明确开放的方法。

---

## 5. renderer 是什么

renderer 是 Chromium 页面。

文件：

```text
src/renderer/chat/index.html
src/renderer/chat/main.ts
src/renderer/chat/style.css
```

它只负责 UI：

```text
显示用户消息
显示 Agent 回复
显示 AgentEvent 日志
处理输入框和发送按钮
```

它不会直接调用模型。

renderer 调 Agent 的方式是：

```ts
const result = await window.cyrene.chat.sendMessage(text);
```

这看起来像普通函数调用，但底层其实走的是 IPC。

---

## 6. IPC 是怎么走的

共享 channel 定义在：

```text
src/shared/ipc-channels.ts
```

目前有两个 channel：

```ts
cyrene:chat:send-message
cyrene:chat:agent-event
```

完整流程：

```text
renderer 输入文本
  -> window.cyrene.chat.sendMessage(text)
  -> preload 调 ipcRenderer.invoke(...)
  -> main 的 ipcMain.handle(...) 收到请求
  -> main 调 runToolAgent(...)
  -> Agent 运行时触发 AgentEvent
  -> main 用 sender.send(...) 发事件给 renderer
  -> renderer 显示事件日志
  -> runToolAgent 返回最终回复
  -> main 把 reply 返回给 renderer
  -> renderer 显示 Agent 回复
```

---

## 7. register-chat-ipc.ts 是关键胶水

文件：

```text
src/main/app/register-chat-ipc.ts
```

它是这阶段最重要的连接点。

它把 Electron IPC 和现有 Agent 连接起来：

```ts
deps.ipcMain.handle(IPC_CHANNELS.chat.sendMessage, async (event, text) => {
  const result = await runAgent({
    messages,
    config,
    adapter,
    toolRegistry,
    onEvent: (agentEvent) => {
      event.sender.send(IPC_CHANNELS.chat.agentEvent, agentEvent);
    },
  });

  return { reply: result.reply };
});
```

这里有两个方向：

```text
invoke 返回值
```

用于返回最终回答。

```text
sender.send
```

用于中途推送 AgentEvent。

这就是为什么之前先做事件流很有用。

---

## 8. Python 类比

如果用 Python 类比，Electron 三层大概像这样：

```python
class MainProcess:
    def handle_send_message(self, text):
        return run_agent(text, on_event=self.send_event_to_renderer)


class PreloadBridge:
    def send_message(self, text):
        return ipc_invoke("send-message", text)

    def on_agent_event(self, callback):
        ipc_on("agent-event", callback)


class RendererPage:
    async def on_click_send(self):
        result = await window.cyrene.chat.sendMessage(input_text)
        show_message(result["reply"])
```

所以 renderer 并不认识 `runToolAgent`。

它只认识：

```text
window.cyrene.chat
```

---

## 9. 怎么运行

先确保 `.env` 里有 API key：

```text
CYRENE_MODEL_API_KEY=你的 key
```

然后运行：

```cmd
npm run dev:electron
```

它会先执行：

```text
build:electron
build:renderer
electron .
```

窗口打开后，在输入框里输入消息。

如果模型触发工具，右侧 `Agent Events` 会显示过程。

---

## 10. 这一阶段你应该理解什么

读完这一阶段，你应该能解释：

1. main、preload、renderer 分别是什么。
2. 为什么 renderer 不能直接访问 Node.js。
3. 为什么 API key 必须留在 main。
4. IPC 为什么需要共享 channel 常量。
5. `ipcRenderer.invoke` 和 `ipcMain.handle` 是一问一答。
6. `sender.send` 可以把 AgentEvent 中途推回页面。
7. 为什么事件流是 UI 的基础。

如果你能画出：

```text
renderer -> preload -> main -> Agent -> main -> preload -> renderer
```

说明你已经理解 Electron Agent 应用的基本骨架了。
