# Phase 9：MCP 外部工具系统学习指南

## 1. 先用一句人话说明 MCP

MCP 让 Agent 可以连接“另一个程序提供的工具”，而不需要把那个程序的代码复制进 Agent。

例如，一个文件系统 MCP Server 可以提供：

- `read_file`：读取文件；
- `list_directory`：列出目录；
- `write_file`：写文件。

Cyrene Agent 不需要知道这些工具底层如何操作文件。它只需要：连接 Server、询问有哪些工具、把工具说明交给模型，并在模型要求调用时把参数转发给 Server。

## 2. MCP 和内置 Tool 的区别

内置 Tool 的实现代码与 Agent 在同一个项目中：

```text
模型 -> ToolRegistry -> 内置 execute() -> 本项目代码
```

MCP Tool 的实现代码在另一个进程或服务中：

```text
模型 -> ToolRegistry -> MCP 适配器 -> MCP Client -> MCP Server -> 外部代码
```

对模型来说，两者最后都是统一的 Tool Schema，所以 Agent Loop 不需要为 MCP 重写一套循环。

## 3. 五个核心名词

### 3.1 MCP Server

提供工具的程序。它负责真正执行 `echo`、数据库查询、文件操作等动作。

### 3.2 MCP Client

Agent 中负责与 Server 对话的一方。本项目使用 `@modelcontextprotocol/sdk` 的 `Client`。

### 3.3 Transport

Client 和 Server 之间搬运消息的方式。本项目支持：

- `stdio`：启动本地子进程，通过标准输入和标准输出通信；
- `Streamable HTTP`：通过 HTTP 请求与服务通信。

Transport 只负责传输。它不知道 `echo` 有什么含义，也不决定工具权限。

### 3.4 JSON-RPC

MCP 消息采用 JSON-RPC 风格。它可以理解为带编号的 JSON 请求和响应：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "echo",
    "arguments": { "text": "hello" }
  }
}
```

SDK 已经封装了消息编号、序列化和匹配响应，本项目不手写 JSON-RPC。

### 3.5 ToolRegistry

Agent 的统一工具目录。内置 Tool、Skill Tool 和 MCP Tool 最终都注册到这里，模型只看统一后的名称、描述和参数 Schema。

## 4. 一次完整连接发生了什么

```text
用户在 MCP 页面添加 Server
  -> Renderer 调用 window.cyrene.mcp.add(config)
  -> Preload 通过固定 IPC Channel 发给 Main
  -> register-mcp-ipc 调用 McpManager.add(config)
  -> 校验并保存配置
  -> TransportFactory 创建 stdio 或 HTTP Transport
  -> McpConnection 创建 SDK Client 并连接 Server
  -> Client.listTools() 获取工具清单
  -> McpToolAdapter 把外部工具改造成 ToolDefinition
  -> 注册到主 ToolRegistry
  -> 页面显示 Connected 和工具列表
```

这里的 `listTools()` 只是询问“你有哪些工具”，不会执行工具。

## 5. 一次 MCP 工具调用发生了什么

假设模型生成：

```json
{
  "name": "demo__echo",
  "arguments": "{\"text\":\"你好\"}"
}
```

执行链如下：

```text
runToolAgent
  -> 当前 ToolRegistry 快照找到 demo__echo
  -> MCP ToolDefinition.execute({ text: "你好" })
  -> 检查工具风险和 Server 信任模式
  -> McpConnection.callTool("echo", { text: "你好" })
  -> SDK Client.callTool(...)
  -> Transport 把请求送到 Server
  -> Server 执行 echo
  -> 返回 MCP Content
  -> ResultNormalizer 转成受长度限制的纯文本
  -> 作为 role=tool 消息交回模型
```

下一轮模型根据工具结果生成最终回答。

## 6. 为什么工具名变成 `server__tool`

两个 Server 都可能提供名为 `search` 的工具。直接注册会重名，所以本项目生成：

```text
github__search
filesystem__search
```

`mcp-tool-adapter.ts` 负责规范化名称，并在名字过长时追加哈希，保证工具 ID 不超过 64 个字符。

## 7. 权限为什么要暂停

只读工具可直接执行；敏感工具默认需要用户批准。

风险判断规则是：只有 Server 明确声明 `readOnlyHint: true`，同时没有声明破坏性，才按只读处理。其他工具保守地视为敏感。

```text
敏感 Tool execute()
  -> ApprovalBroker 创建 requestId
  -> Main 将请求发给 Renderer
  -> Renderer 显示批准/拒绝对话框
  -> 用户选择
  -> Renderer 通过 IPC 返回决定
  -> Broker 用 requestId 找到暂停的 Promise
  -> 批准：继续 callTool()
  -> 拒绝：返回 MCP_PERMISSION_DENIED
```

这里不是阻塞整个 Electron。只是该工具调用对应的 Promise 在等待，界面和其他异步任务仍能运行。

Server 的信任模式：

- `ask-sensitive`：敏感工具每次询问；
- `trusted`：允许该 Server 的敏感工具直接执行。

## 8. 为什么每次聊天都创建 Registry 快照

MCP Server 可以在程序运行时连接、断开或改变工具列表。

如果聊天模块启动时只读取一次 Registry，后来新增的 MCP Tool 就不会出现。现在 `register-chat-ipc.ts` 在每次收到用户消息时调用：

```ts
createToolRegistry: () => mcpRuntime.manager.createToolRegistrySnapshot()
```

本轮 Agent 使用固定快照，避免执行过程中工具目录突然变化；下一轮聊天再读取最新快照。

## 9. 配置如何保存

配置保存到 Electron `userData` 目录中的 `mcp-servers.json`，使用临时文件加重命名的原子写入方式。

配置包括：

- Server ID、显示名称和启用状态；
- `stdio` 的 command、args、cwd、env；
- HTTP 的 URL、headers；
- 信任模式；
- 单个工具的启用和风险覆盖。

密钥不能直接写进配置，只能写成环境变量引用：

```json
{
  "Authorization": "${MCP_API_TOKEN}"
}
```

运行时才从 `process.env.MCP_API_TOKEN` 取真实值，避免 Token 落盘。

普通 `http://` 只允许 `localhost`、`127.0.0.1` 或 `::1`；远程服务必须使用 HTTPS。

## 10. 断线和关机

意外断线采用有限重连：等待 1 秒、3 秒、10 秒后分别尝试，之后停止，避免无限循环。

应用退出时：

1. 停止接受新的敏感操作批准；
2. 让待批准请求以 `SHUTDOWN` 结束；
3. 注销 MCP Tool；
4. 等待正在执行的调用，最多等待规定的 drain 时间；
5. 关闭 Client、Transport 和子进程；
6. 与记忆后台任务一起完成统一关机。

## 11. 文件按功能分组

### 配置

- `mcp-types.ts`：MCP 配置、状态、工具等 TypeScript 数据格式；
- `mcp-config-validation.ts`：严格校验配置和安全限制；
- `mcp-config-store.ts`：读取和原子保存 JSON 配置。

### 协议边界

- `mcp-transport-factory.ts`：根据配置创建 stdio/HTTP Transport；
- `mcp-connection.ts`：连接、`listTools()`、`callTool()`、超时和关闭；
- `mcp-schema-normalizer.ts`：把外部 JSON Schema 限制在 Agent 支持的安全范围；
- `mcp-result-normalizer.ts`：把 MCP Content 转成有限长度文本。

### Agent 适配和管理

- `mcp-tool-adapter.ts`：把 MCP Tool 变成 `ToolDefinition`；
- `mcp-permission.ts`：风险策略和等待用户决定的 Broker；
- `mcp-manager.ts`：管理多个 Server、连接状态、重连和动态注册；
- `create-mcp-runtime.ts`：把 Store、Manager、Connection、Approval 组装起来。

### Electron

- `register-mcp-ipc.ts`：Main 中处理 Renderer 的 MCP 管理请求；
- `mcp-api-types.ts`：Main、Preload、Renderer 共用的 API 数据契约；
- `preload/index.ts`：只暴露允许使用的 `window.cyrene.mcp` 方法；
- `mcp-view.ts`：Server 和 Tool 管理界面；
- `mcp-approval-view.ts`：敏感操作批准窗口；
- `mcp-view-model.ts`：把后端状态转换为界面显示数据。

## 12. Server 指令为什么不放进 System Prompt

当前阶段只接入 MCP Tools，不自动采纳 Server 提供的 Prompt 或 Instructions。

外部 Server 不应仅凭连接就能修改 Agent 的最高层指令。这样可以减少提示词注入风险，也让 System Prompt 的来源保持清晰。以后若支持 MCP Resources/Prompts，应经过显式选择和独立的信任策略。

## 13. 自动化测试

真实 MCP 冒烟测试：

```powershell
npm.cmd run test:mcp
```

它会在临时目录中启动：

- 一个 stdio MCP Server；
- 一个监听随机本地端口的 Streamable HTTP MCP Server。

两者都提供 `echo`、`read_demo`、`write_demo`。测试验证发现 3 个工具、调用 `echo`、批准后执行 `write_demo`，最后关闭进程并删除临时目录。

Electron 冒烟测试：

```powershell
npm.cmd run test:electron-smoke
```

它会打开隔离的 Electron 用户目录，添加真实 stdio Server，确认界面显示 Connected 和 3 个工具，再清理配置。

完整验收：

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:mcp
npm.cmd run test:electron-smoke
```

## 14. 当前边界

Phase 9 已实现 MCP Tools，但没有实现 MCP Resources、Prompts、Roots、Sampling 和远程 OAuth。语音与通话也不属于本阶段。

这不是缺陷，而是明确控制范围：先让外部工具发现、调用、授权、管理、重连和关机这条主链稳定，再扩展其他 MCP 能力。
