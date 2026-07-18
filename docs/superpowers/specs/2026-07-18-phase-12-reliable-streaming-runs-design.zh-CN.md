# Phase 12：可靠运行、流式输出与诊断中心设计

## 1. 背景

项目已经具备持久化多会话、工具调用、RAG、长期记忆、Skills、MCP 和 Scheduler，但一次 Agent 运行仍由 Chat 与 Scheduler 各自管理。普通聊天使用等待最终结果的 IPC，模型请求没有统一取消边界，运行事件只在当前进程中短暂展示，错误通常被压缩为通用代码，Token、首字延迟、排队时间和每轮模型耗时也没有形成可查询记录。

Phase 12 建立共享的运行控制层，使 Chat 与 Scheduler 使用同一套并发、取消、超时、重试、Trace、用量统计和错误分类；普通聊天同时升级为真正的流式输出。

## 2. 已确认的产品决策

- 采用共享 `AgentRunManager`，不继续向 `register-chat-ipc.ts` 堆叠运行控制逻辑。
- 普通聊天支持 SSE 流式输出和用户停止生成。
- Scheduler 共享可靠性、Trace 和用量统计，但不在任务历史中逐字显示输出。
- Trace 默认脱敏保存，最多保留最近 1000 次运行，并删除超过 30 天的记录。
- 每个会话同时最多有一个用户触发的顶层 Agent Run；全局默认最多同时运行两个顶层 Run。
- 排队中和运行中的 Run 都可以取消。
- 取消时保留已经生成的 Assistant 内容，并标记为不完整的 `cancelled` 消息。
- 取消采用安全取消：中断模型请求、阻止新工具启动；不强杀无法响应取消的已启动工具。
- Phase 12 为未来 Subagent 预留 `parentRunId`，但不实现 Subagent。
- 不采用完整事件溯源，不根据 Trace 重放或恢复崩溃前的 Agent Run。

## 3. 总体架构

```text
Renderer / Scheduler
        |
        v
Chat IPC / Scheduler Runtime
        |
        v
AgentRunManager
|- AgentRunQueue
|- AgentRunController
|- AgentRunStore
|- TraceSanitizer
|- RetryPolicy
`- UsageCollector
        |
        v
runToolAgent
        |
        v
Vendor Streaming Client
        |
        v
DeepSeek / OpenAI-compatible API
```

建议新增目录：

```text
src/main/runs/
|- agent-run-types.ts
|- agent-run-error.ts
|- agent-run-queue.ts
|- agent-run-controller.ts
|- agent-run-manager.ts
|- agent-run-store.ts
|- trace-sanitizer.ts
|- retry-policy.ts
|- usage-collector.ts
`- run-retention.ts
```

`register-chat-ipc.ts` 继续负责会话、人格、记忆召回、上下文构建和回答后的记忆写入。运行排队、AbortController、超时、Trace、Token 和状态转换交给 `AgentRunManager`。Scheduler 通过同一个 Manager 提交运行，不再维护第二套 Agent 可靠性规则。

## 4. 运行模型

### 4.1 身份

每个运行至少包含：

```ts
interface AgentRunIdentity {
  runId: string;
  parentRunId?: string;
  source: "chat" | "scheduler";
  conversationId?: string;
  requestId?: string;
  taskId?: string;
}
```

Chat Run 必须包含 `conversationId` 和 `requestId`。Scheduler Run 必须包含 `taskId`。`parentRunId` 只作为未来子运行的兼容字段，本阶段始终为空。

### 4.2 状态机

```text
queued -> running -> succeeded
                  -> failed
                  -> cancelled
queued ----------------> cancelled
```

终态不可再次变化。用户取消不属于普通错误，不生成 `run_error`，但生成 `run_cancel_requested` 和 `run_cancelled` Trace 事件。

### 4.3 AgentRunManager

Manager 是 Chat 和 Scheduler 的统一入口，负责：

- 验证提交参数并生成运行记录；
- 将运行提交到 Queue；
- 在获得执行名额后创建 Controller；
- 转发 Domain Event、流式文本和状态事件；
- 汇总 Usage、耗时、轮数和工具调用；
- 完成、失败或取消运行；
- 关闭时停止接受新运行、取消排队运行并安全排空存储。

提交接口立即返回，不等待整个模型回答：

```ts
interface AgentRunSubmission {
  runId: string;
  status: "queued" | "running";
}
```

## 5. 受控并发

默认全局并发为 2，通过 `CYRENE_AGENT_MAX_CONCURRENT_RUNS=2` 配置。每个 `conversationId` 同时最多一个运行。Scheduler 没有会话锁，但占用全局名额。

Queue 保持提交顺序，同时避免队首阻塞：如果队首属于正在运行的会话，Queue 可以继续扫描后面的、满足约束的运行。一个 Run 获得名额后必须原子地登记全局槽位和会话锁。

取消 queued Run 时不创建 Controller、不调用模型、不执行工具，直接保存 `cancelled` 终态。运行结束后 Manager 释放槽位和会话锁，再调度下一个可执行 Run。

## 6. 流式模型协议

### 6.1 Vendor 边界

Vendor Adapter 增加流式能力声明和解析接口。当前 OpenAI-compatible Adapter 实现 SSE；未来不支持 Streaming 的 Adapter 可以回退到普通完成请求，并一次性产生 Assistant Snapshot。

流式解析器必须处理：

- 空行、注释行和跨网络块拆分的 SSE Frame；
- `[DONE]`；
- Assistant 文本 Delta；
- Tool Call 的 ID、名称和参数 Delta；
- `finish_reason`；
- Provider Usage；
- 非法 JSON、意外结束和 AbortError。

工具参数可能跨多个 Delta，必须在本轮流结束后完整拼接并经过现有参数验证，不能边接收边执行。

### 6.2 Agent Loop

`runToolAgent` 接收标准运行上下文：

```ts
interface ToolAgentRunContext {
  runId: string;
  signal: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  onTextDelta?: (delta: string) => void;
  retryPolicy: ModelRetryPolicy;
}
```

每轮模型响应可能产生文本或 Tool Calls。Tool Calls 执行完后进入下一轮流式模型请求。取消检查点至少位于：模型请求前、每个 Tool Call 前、Tool Call 返回后和下一轮开始前。

## 7. IPC 与 Renderer 数据流

发送消息的 IPC 立即返回：

```ts
interface ConversationRunAccepted {
  runId: string;
  conversationId: string;
  requestId: string;
  status: "queued" | "running";
}
```

Main 通过固定 Channel 推送：

```ts
interface RunEventEnvelope {
  runId: string;
  conversationId?: string;
  requestId?: string;
  sequence: number;
  timestamp: string;
  event: AgentRunEvent;
}
```

`sequence` 在单个 Run 内从 1 递增。Renderer 按 `runId` 路由，只接受比已处理序号更大的事件，防止切换会话时串流或重复处理。

主要事件为：

```text
run_queued
run_started
assistant_delta
assistant_snapshot
model_call_started
model_call_finished
tool_call_started
tool_call_finished
run_succeeded
run_failed
run_cancel_requested
run_cancelled
```

Preload 暴露固定 API：

```ts
runs.list(filters?)
runs.get(runId)
runs.cancel(runId)
runs.remove(runId)
runs.clear()
runs.export(runId)
runs.onChanged(listener)
runs.onEvent(listener)
```

Renderer 不获得 `ipcRenderer`，也不能给导出接口传任意文件路径。导出由 Main 打开 Electron 保存对话框并写入脱敏 JSON。

## 8. 流式会话持久化

会话消息状态扩展为：

```text
pending | streaming | complete | failed | cancelled
```

流程为：

```text
保存 pending 用户消息
-> Run 获得执行名额
-> 用户消息转 complete
-> 创建 streaming Assistant 消息
-> 接收 Delta 并更新内存
-> 最多每 1 秒原子保存一次检查点
-> 正常结束转 complete
-> 用户取消转 cancelled
-> 失败转 failed
```

正常结束、取消、失败和应用退出必须强制写入最后检查点。启动时遗留的 `pending` 或 `streaming` 状态迁移为 `failed`，保留已有文本。

只有完整 `complete` 回合进入 Context Manager、会话摘要、历史向量索引和长期记忆判断。`cancelled`、`failed`、`streaming` 消息可见且持久化，但不作为可信历史自动注入模型。

## 9. 安全取消

每个 running Run 拥有一个 `AbortController`。

- queued：从队列移除并直接转 cancelled；
- 模型请求中：调用 `abort()`，保存已有文本并转 cancelled；
- 工具开始前：检测 Signal，禁止启动；
- 工具执行中：把 Signal 传给 Tool；支持取消的 Tool 主动停止；不支持取消的 Tool 自然结束；
- 工具返回后：若已取消，只写 Trace，不追加新的模型轮次。

取消不能承诺撤销已经提交给外部系统的副作用。UI 必须使用“已停止继续运行”，不能声称外部操作已回滚。

## 10. 超时与重试

默认配置：

```env
CYRENE_MODEL_REQUEST_TIMEOUT_MS=120000
CYRENE_TOOL_TIMEOUT_MS=300000
CYRENE_AGENT_RUN_TIMEOUT_MS=600000
```

超时错误分别为 `MODEL_REQUEST_TIMEOUT`、`TOOL_EXECUTION_TIMEOUT` 和 `AGENT_RUN_TIMEOUT`。工具超时不强杀无法响应 Signal 的 Tool，Trace 必须标记外部操作状态可能不确定。

模型请求仅对网络错误、HTTP 408、425、429 和 5xx 重试，最多 3 次，默认等待 500ms、1000ms。400、401、403、非法响应和用户取消不重试。

只有本次请求尚未产生有效文本或 Tool Call Delta 时允许重试。流已开始后中断则保存部分文本并返回 `MODEL_STREAM_INTERRUPTED`，避免重复文本或重复工具。

工具不由框架自动重试，尤其是写文件、删除、创建 Issue 和发送消息等有副作用操作。Agent 可以看到失败结果并自行选择其他方案，但运行框架不静默重复执行。

## 11. 结构化错误

```ts
interface AgentRunError {
  code: AgentRunErrorCode;
  category: "cancelled" | "timeout" | "network" | "provider" | "tool" | "validation" | "internal";
  retryable: boolean;
  safeMessage: string;
  httpStatus?: number;
  causePreview?: string;
}
```

错误代码至少覆盖：

```text
RUN_CANCELLED
RUN_QUEUE_REJECTED
MODEL_NETWORK_FAILED
MODEL_REQUEST_TIMEOUT
MODEL_HTTP_400
MODEL_HTTP_401
MODEL_HTTP_429
MODEL_HTTP_5XX
MODEL_STREAM_INTERRUPTED
MODEL_RESPONSE_INVALID
TOOL_ARGUMENTS_INVALID
TOOL_NOT_AVAILABLE
TOOL_EXECUTION_FAILED
TOOL_EXECUTION_TIMEOUT
MCP_PERMISSION_DENIED
AGENT_MAX_ROUNDS_EXCEEDED
AGENT_RUN_TIMEOUT
INTERNAL_ERROR
```

Renderer 只展示 `safeMessage`。原始异常写入 Trace 前必须脱敏。

## 12. Trace 与用量

### 12.1 两层记录

Run Summary 用于列表，包含身份、状态、时间、耗时、轮数、模型调用数、工具调用数、Token 和错误代码。Run Trace 用于详情，按 `sequence` 保存运行事件。

核心 Trace 事件包括：

```text
run_queued / run_started / run_succeeded / run_failed
run_cancel_requested / run_cancelled
context_built
model_request_started / model_stream_started / model_stream_finished
model_retry_scheduled
tool_call_started / tool_call_finished / tool_call_failed / tool_call_cancelled
conversation_checkpoint_saved
```

`context_built` 只保存 Token 和选取数量，不复制完整 System Prompt。

### 12.2 脱敏

字段名匹配 `token`、`secret`、`password`、`authorization`、`apiKey`、`cookie`、`credential` 时替换为 `[REDACTED]`。字符串额外识别 Bearer、常见 `sk-` 凭证和 Authorization Header。

限制：用户问题预览 500 字符、模型预览 1000 字符、工具参数和结果各 2000 字符、对象深度 5、数组 50 项。Trace 不复制完整会话正文。

### 12.3 Usage 与时间

每次模型调用记录输入、输出和总 Token，并标记来源 `provider` 或 `estimated`。优先使用 Provider Usage；缺失时使用现有 TokenEstimator。Run Usage 是所有模型轮次之和。

时间统计至少包括排队等待、上下文组装、首字延迟、每轮模型耗时、每个工具耗时和总运行时间。Phase 12 不计算货币费用。

## 13. Run Store 与保留策略

```text
userData/runs/
|- index.json
|- records/run_*.json
`- corrupt/
```

Store 使用版本化 Schema、原子写入和串行更新。索引缺失或损坏时从 records 重建；单条损坏记录进入 corrupt；未知的新版本不得被旧程序覆盖。

每次初始化和新增记录后执行保留策略：删除超过 30 天的记录；若仍超过 1000 条，再从最旧记录删除。支持删除单条、清空和导出脱敏 Trace。

## 14. Scheduler 集成

Scheduler 使用共享 Manager 的全局并发、重试、超时、错误、Trace、Usage 和取消。任务历史仍只保存最终回答，不显示逐字 Delta。Tasks 页面允许取消 queued 或 running 的任务运行。

Scheduler 不允许重试整个 Agent Run，因为这可能重复工具副作用；只允许模型请求层在尚未产生 Delta 时重试。

## 15. Runs 诊断页面

Electron 顶部增加 Runs 页面。页面上方提供状态、来源和时间筛选，以及刷新和清空命令。主体为运行列表与详情区域，不把页面区块包装成嵌套卡片。

列表显示状态、来源、开始时间、耗时、轮数、工具数和 Token。详情显示按时间排序的 Trace、错误代码、Usage 来源和耗时分解。支持取消活动运行、删除记录和导出脱敏 JSON。

Runs 页面通过 IPC 事件实时更新，不轮询磁盘。窄屏下列表和详情改为上下布局，所有按钮、标题和时间文本不得溢出。

## 16. 数据迁移与关闭

Conversation Schema 升级以支持 streaming/cancelled。旧 complete/failed 保持不变；启动时遗留 pending/streaming 转 failed。原内容不删除。

关闭顺序：停止接收新运行；取消 queued；请求取消 running；等待安全结束或总关闭期限；保存最终会话检查点；flush Conversation Store、Run Store、Scheduler、记忆和向量后台任务。

## 17. 测试策略

单元测试覆盖 Queue 并发与公平性、取消、超时、重试边界、SSE 拆帧、Tool Call Delta 拼接、Token 汇总、Trace 脱敏、保留策略和迁移。

集成测试覆盖 Chat 到 Fake Streaming API 的完整链路、工具后继续流式、取消保存部分文本、取消后不再调用模型、双会话并发、同会话排队、Chat 与 Scheduler 竞争槽位及 Trace 重启读取。

Electron 冒烟测试覆盖流式增长、Stop、取消状态、Runs 页面、窄屏布局和重启持久化。真实 DeepSeek、Ollama、GitHub MCP 和 Scheduler 验收由显式手动命令触发，不进入默认 `npm test`，避免消耗 API 额度。

## 18. 非目标

Phase 12 不实现：Subagent；崩溃后继续未完成 Run；强杀外部工具；工具自动重试；完整事件溯源和重放；Scheduler 逐字输出；云日志；多设备 Trace 同步；模型费用；语音流。

## 19. 实施顺序

1. 独立提交当前定时任务可靠性修复，建立干净基线；
2. Run 类型、错误和脱敏；
3. Run Store 与保留策略；
4. Queue、Controller 和 Manager；
5. AbortSignal、超时和重试；
6. Vendor SSE 流式解析；
7. ToolAgent 流式与取消；
8. Conversation 流式状态、检查点和迁移；
9. Chat IPC、Preload 与 Renderer 流式聊天；
10. Scheduler 接入共享运行系统；
11. Runs 诊断页面；
12. 全量测试、真实环境验收和中文学习文档。

## 20. 完成标准

- 普通聊天能够稳定流式显示并安全停止；
- cancelled 部分回答跨重启保留但不进入可信上下文；
- 全局双并发和每会话单顶层运行约束通过确定性测试；
- Chat 与 Scheduler 共用重试、超时、错误、Trace 和 Usage；
- Trace 脱敏、30 天和 1000 条策略通过测试；
- Runs 页面可查询、取消、删除和导出运行；
- 全部测试、typecheck、生产构建和 Electron 冒烟测试通过；
- 真实 DeepSeek 流式文本与 Tool Calling 完成一次显式验收；
- 项目中不存在提交的密钥或未经脱敏的 Trace 测试夹具。
