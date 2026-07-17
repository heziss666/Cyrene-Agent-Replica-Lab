# Phase 9：MCP 客户端与外部工具系统设计

## 1. 背景与目标

当前项目的工具全部由应用内部注册，例如时间、计算器、RAG 和 Skills 元工具。Phase 9 增加 MCP Client，使应用可以连接独立的 MCP Server，发现其工具，并将这些工具安全地接入现有 `ToolRegistry` 和 Agent Loop。

本阶段参考源项目的 MCP Adapter 和 MCP Manager，但不直接照搬以下问题：全局单例、旧版 SSE、同步文件写入、弱配置校验、工具风险默认安全、密钥可能混入配置，以及连接变化与正在运行的 Agent 相互干扰。

最终调用链为：

```text
Electron 启动
→ McpManager 读取配置
→ MCP Client 连接 Server
→ listTools() 发现工具
→ McpToolAdapter 转为 ToolDefinition
→ ToolRegistry 向模型暴露工具
→ 模型请求调用工具
→ 权限网关允许、询问或拒绝
→ callTool() 发送给 MCP Server
→ 结果回到 Agent Loop
→ 模型生成后续回答
```

## 2. 范围

Phase 9 实现：

- 官方稳定版 TypeScript MCP SDK；
- 本地 `stdio` transport；
- 远程 Streamable HTTP transport；
- 多 Server 配置、持久化、启动恢复和生命周期管理；
- MCP Tools 的发现、命名、Schema 规范化、动态注册与调用；
- Server 和单个 Tool 的启用状态；
- 只读、敏感操作和信任 Server 的分级权限；
- Electron MCP 管理页面与调用确认界面；
- MCP 领域事件、错误隔离、超时、有限重连和优雅关闭；
- 本地测试 Server、自动化测试和中文学习文档。

Phase 9 不实现：

- MCP Resources、Prompts、Sampling、Elicitation 和 Tasks；
- OAuth 登录和动态客户端注册；
- 已弃用的旧版 HTTP+SSE transport；
- 在线 MCP 市场、自动下载或自动更新；
- Agent 静默安装 MCP Server；
- Skill 自带脚本执行、`skill-creator` 或自修改 Agent。

MCP Server 返回的 instructions 只在管理页面展示，不自动加入 System Prompt，防止外部 Server 未经确认永久改变 Agent 行为。

## 3. 技术选择

使用官方稳定版 `@modelcontextprotocol/sdk`，不采用仍可能发生破坏性变化的 beta SDK，也不自行实现 JSON-RPC。

本地 Server 使用 `StdioClientTransport`。应用以独立子进程启动 Server，通过 stdin/stdout 交换 MCP JSON-RPC 消息。启动时不使用 shell 字符串解析。

远程 Server 使用 `StreamableHTTPClientTransport`。只允许：

- `https://`；
- `http://localhost`、`http://127.0.0.1` 和 `http://[::1]`。

## 4. 模块划分

新增 `src/main/mcp/`：

```text
mcp-types.ts
mcp-config-validation.ts
mcp-config-store.ts
mcp-transport-factory.ts
mcp-schema-normalizer.ts
mcp-result-normalizer.ts
mcp-tool-adapter.ts
mcp-connection.ts
mcp-manager.ts
mcp-permission.ts
create-mcp-runtime.ts
```

各模块职责：

- `mcp-types.ts`：配置、连接状态、工具快照、风险和公开 View 类型。
- `mcp-config-validation.ts`：把 IPC、磁盘和环境变量视为未知输入并严格校验。
- `mcp-config-store.ts`：读取、迁移、隔离损坏文件并原子写入配置。
- `mcp-transport-factory.ts`：根据已验证配置创建 stdio 或 Streamable HTTP transport。
- `mcp-schema-normalizer.ts`：限制并转换外部工具的 JSON Schema。
- `mcp-result-normalizer.ts`：把 MCP content blocks 转成 Agent Loop 使用的受限字符串。
- `mcp-tool-adapter.ts`：将 MCP Tool 包装成 `ToolDefinition`，但不管理连接。
- `mcp-connection.ts`：持有一个 Server 的 Client、transport、工具快照和活动调用计数。
- `mcp-manager.ts`：管理多个连接、配置、重连、工具同步和关闭顺序。
- `mcp-permission.ts`：根据工具注解、用户覆盖和 Server 信任状态决定执行策略。
- `create-mcp-runtime.ts`：组装以上对象，供 `main.ts` 注入。

Electron 边界新增：

```text
src/main/app/register-mcp-ipc.ts
src/shared/mcp-api-types.ts
src/renderer/chat/mcp-view.ts
src/renderer/chat/mcp-view-model.ts
src/renderer/chat/mcp-approval-view.ts
```

## 5. 配置模型

配置使用可辨识联合类型：

```ts
type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

interface McpServerBaseConfig {
  id: string;
  name: string;
  enabled: boolean;
  trust: "ask-sensitive" | "trusted";
  toolOverrides: Record<string, {
    enabled?: boolean;
    risk?: "read" | "sensitive";
  }>;
}

interface McpStdioServerConfig extends McpServerBaseConfig {
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
}

interface McpHttpServerConfig extends McpServerBaseConfig {
  transport: "streamable-http";
  url: string;
  headers: Record<string, string>;
}
```

Server ID 必须匹配 `^[a-z0-9][a-z0-9-]*$`。Server ID、工具原始名称和配置共同决定稳定的工具 ID：

```text
<server-id>__<normalized-tool-name>
```

若规范化后发生冲突，则对应工具不可用并产生诊断，不覆盖内置 Tool 或其他 Server 的 Tool。

配置保存在：

```text
<userData>/mcp-servers.json
```

文件包含 `schemaVersion` 和 Server 数组，采用临时文件加 rename 的原子写入。损坏文件被隔离，应用以空配置继续启动。

环境变量值支持 `${NAME}` 引用。配置文件只保存引用，Main 在创建 transport 前从 `process.env` 解析真实值。Renderer 列表接口只返回脱敏后的配置，不返回解析后的 header 或 env 值。

## 6. ToolRegistry 调整

现有 Registry 增加：

- `unregister(id)`；
- 拒绝意外覆盖的注册结果；
- 工具来源元数据：`builtin | skill | mcp`；
- MCP Server ID 和原始工具名元数据；
- 创建每轮 Agent 使用的稳定快照；
- 按 owner 批量删除 MCP 工具。

应用保留一个基础 Registry。每轮聊天开始时创建快照，避免 MCP 页面正在重连或删除 Server 时改变本轮已经发送给模型的工具列表。

Server 断开后，新一轮对话不再看到其工具。已经开始的 MCP 调用允许在关闭等待期内结束；等待超时后强制关闭，调用返回稳定错误。

## 7. 连接生命周期

连接状态：

```text
disabled
connecting
connected
reconnecting
disconnecting
disconnected
error
```

启动顺序：

1. `app.whenReady()`；
2. 创建基础 ToolRegistry 和 SkillRuntime；
3. 创建 McpRuntime；
4. 加载配置；
5. 并发受限地连接已启用 Server；
6. 注册 MCP Tools；
7. 注册 Chat、Memory、Skills 和 MCP IPC；
8. 创建窗口。

单个 Server 失败不会阻止窗口和聊天启动。失败状态、稳定错误码和最近一次错误会显示在 MCP 页面。

意外断开采用有限指数退避重连，例如 1 秒、3 秒、10 秒，最多三次。用户手动断开、禁用、删除或应用退出时不自动重连。页面提供手动重连。

如果 Server 声明工具列表变化通知，则重新执行 `listTools()`，验证完整新快照后一次性替换该 Server 的工具；失败时保留最后一个有效快照并标记诊断。

## 8. MCP 工具适配

连接成功后执行 `listTools()`。每个工具经过以下步骤：

1. 校验名称、描述和 inputSchema；
2. 生成带 Server 命名空间的工具 ID；
3. 规范化 JSON Schema；
4. 读取 MCP annotations 并计算默认风险；
5. 合并用户的工具启用和风险覆盖；
6. 创建闭包形式的 `ToolDefinition.execute()`；
7. 原子更新该 Server 的工具集合。

`ToolDefinition` 的 Schema 类型扩展为安全的递归 JSON Schema 子集，至少支持 object、array、string、number、integer、boolean、null、enum、required、additionalProperties、anyOf 和 oneOf。最大深度、节点数和序列化大小均受限制；无法安全转换的工具不会注册。

工具数量限制：

- 每个 Server 最多 50 个可用工具；
- 全部 MCP Server 最多 100 个可暴露工具；
- 超额工具保留在诊断中，不进入模型上下文。

## 9. 结果规范化

MCP `callTool()` 可能返回文本、结构化内容、图片、音频或 resource link。当前 Agent Loop 的工具结果是字符串，因此：

- text block 保留文本；
- structured content 序列化为受限 JSON；
- resource link 返回名称、URI 和描述摘要；
- 图片和音频只返回类型、MIME 和大小说明，不把 base64 直接塞进模型上下文；
- `isError: true` 转成稳定的工具错误结果；
- 最终结果按项目统一上限截断。

原始密钥、transport 对象、绝对配置路径和内部堆栈不进入 AgentEvent 或 Renderer。

## 10. 权限模型

风险等级简化为：

```text
read
sensitive
```

默认计算规则：

- `readOnlyHint === true` 且 `destructiveHint !== true`：`read`；
- `destructiveHint === true`：`sensitive`；
- 注解缺失、矛盾或无法识别：`sensitive`。

外部 Server 的注解不是安全证明，只用于保守分类。用户可在 MCP 页面把具体工具提升为 `sensitive`，或在明确了解工具后改为 `read`。

执行策略：

| 工具风险 | Server 信任状态 | 结果 |
| --- | --- | --- |
| read | 任意 | 自动允许 |
| sensitive | ask-sensitive | 每次询问 |
| sensitive | trusted | 自动允许 |

Server 添加页面必须明确说明：stdio 会启动本地程序，HTTP 会向远程地址发送模型生成的参数。用户主动保存并启用 Server 视为允许建立连接，但不等于允许所有敏感工具调用。

## 11. 审批流程

Main 维护 pending approval Map：

```text
MCP Tool 准备执行
→ Main 创建 approvalId
→ 向 Renderer 发送审批请求
→ Renderer 显示 Server、工具、风险和参数
→ 用户允许或拒绝
→ Renderer 通过固定 IPC 回传
→ Main 恢复对应 Promise
```

60 秒无响应、窗口全部关闭、应用退出或 payload 不匹配时自动拒绝。审批 ID 单次有效，重复响应无效。Renderer 不能自行构造一个工具调用，只能响应 Main 已登记的 approval ID。

## 12. IPC 与 Preload API

新增 Channel：

```text
cyrene:mcp:list
cyrene:mcp:add
cyrene:mcp:update
cyrene:mcp:remove
cyrene:mcp:reconnect
cyrene:mcp:set-enabled
cyrene:mcp:set-tool-options
cyrene:mcp:approval-request
cyrene:mcp:resolve-approval
```

Preload 暴露窄接口：

```ts
window.cyrene.mcp.list()
window.cyrene.mcp.add(config)
window.cyrene.mcp.update(id, patch)
window.cyrene.mcp.remove(id)
window.cyrene.mcp.reconnect(id)
window.cyrene.mcp.setEnabled(id, enabled)
window.cyrene.mcp.setToolOptions(serverId, toolName, options)
window.cyrene.mcp.onApprovalRequested(listener)
window.cyrene.mcp.resolveApproval(id, allowed)
```

Main 对所有 payload 再次验证。Renderer 不能传入任意配置文件路径、transport 对象、回调代码或已解析密钥。

## 13. Electron MCP 页面

主导航增加 `MCP` 标签。页面包含：

- Server 列表、transport、状态、工具数量和最近错误；
- 添加 Server 表单；
- 启用/禁用开关；
- 信任模式选择；
- 重连和删除按钮；
- 展开的工具列表；
- 每个工具的启用状态、风险和描述；
- 脱敏后的 env/header 引用；
- 页面级刷新状态。

高风险调用使用模态审批界面，参数以格式化 JSON 显示。审批界面必须有清晰的允许与拒绝操作，默认焦点放在拒绝，关闭弹窗等同拒绝。

## 14. 事件与日志

新增领域事件：

```text
mcp_server_connecting
mcp_server_connected
mcp_server_disconnected
mcp_server_failed
mcp_tools_changed
mcp_tool_approval_requested
mcp_tool_approval_resolved
```

MCP Tool 调用继续触发通用 `tool_call_started` 和 `tool_call_finished`。领域事件用于解释连接和审批过程，不取代通用工具事件。

事件只包含安全字段，例如 Server ID、工具 ID、数量、状态和稳定错误码。密钥、header、env 值、完整 stderr 和内部异常不进入 Renderer 事件流。

## 15. 错误处理与资源限制

- 连接、握手、工具发现和调用分别设置超时；
- 单个 Server 故障不影响其他连接；
- 单个 Tool Schema 无效只禁用该工具；
- 配置更新采用“先验证和连接，再持久化并替换”策略；
- 删除和关闭等待活动调用，超过宽限期后强制结束；
- stdio 的 stderr 仅进入受限 Main 日志，不作为协议 stdout；
- tool result、description、Schema、Server 数量和工具数量均设置上限；
- 关闭阶段由现有 shutdown runtime 等待 MCP 连接排空。

## 16. 测试策略

项目内增加确定性的测试 MCP Server fixture：

```text
echo       安全回显
read_demo  带 readOnlyHint
write_demo 带 destructiveHint
```

同一组行为分别通过 stdio 和本地 Streamable HTTP fixture 验证，不依赖公网或第三方服务。

单元测试覆盖：

- 配置联合类型、ID、URL、命令、环境变量引用和大小限制；
- 原子存储、损坏隔离和 schemaVersion；
- JSON Schema 正常转换、超深、超大和非法结构；
- MCP result 各 content block 和截断；
- 风险推导、用户覆盖、信任模式和默认保守策略；
- 工具命名冲突、批量注册、批量删除和 Registry 快照；
- 审批允许、拒绝、超时、重复响应和无窗口；
- 重连次数、手动关闭不重连和优雅关闭。

集成测试覆盖：

- MCP 握手、`listTools()`、`callTool()` 和工具列表变化；
- MCP Tool 进入真实 Agent Loop；
- Server 断开后新 Agent Run 不再看到工具；
- 配置重启恢复；
- IPC 与 Preload API 的参数和返回值；
- Renderer MCP 页面和审批弹窗。

最终执行：

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:mcp
npm.cmd run test:electron-smoke
```

## 17. 学习文档

新增 `docs/learning/phase-09-mcp.zh-CN.md`，按以下顺序解释：

1. MCP 与内置 Tool 的区别；
2. Client、Server、Transport 和 JSON-RPC；
3. stdio 与 Streamable HTTP；
4. `listTools()` 和 `callTool()`；
5. MCP Tool 如何进入 ToolRegistry；
6. 权限确认如何暂停并恢复一次工具调用；
7. Electron 页面如何通过 Preload 和 IPC 管理 MCP；
8. 如何连接并测试一个真实 MCP Server。

## 18. 完成标准

Phase 9 只有同时满足以下条件才完成：

1. 用户能在 Electron 中添加、查看、启用、重连和删除 MCP Server；
2. stdio 与 Streamable HTTP 都能完成握手、工具发现和调用；
3. MCP Tool 能进入现有 ToolRegistry 和 Agent Loop；
4. 每轮 Agent 使用稳定工具快照，连接变化不会破坏当前运行；
5. 只读工具可自动执行，敏感和未知工具默认审批；
6. 配置和密钥不泄漏到 Renderer、事件或模型上下文；
7. Server 故障、配置损坏和工具异常不拖垮普通聊天；
8. 重启后配置和工具设置恢复；
9. 本地 stdio、HTTP fixture 和真实 Electron smoke 全部通过；
10. 中文学习文档能够串起完整 MCP 调用链。

