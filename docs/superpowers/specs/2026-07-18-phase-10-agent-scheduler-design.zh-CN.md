# Phase 10：Agent 定时任务系统设计

## 1. 背景与目标

项目当前包含一个 `MemoryScheduler`，它只在内部触发记忆维护，不接受用户任务，也不会运行通用 Agent Loop。Phase 10 新增独立的 `TaskScheduler`，让用户可以规定“什么时候让 Agent 自动完成什么任务”。

典型任务：

```text
每天 09:00 检查指定 GitHub 仓库的未关闭 Issue 和最近提交，生成中文摘要。
```

到期后的调用链：

```text
TaskScheduler 发现任务到期
→ ScheduledAgentRunner 创建独立 Agent 执行上下文
→ 组合 System Prompt、Skill Catalog 和相关长期记忆
→ 获取当时最新的 ToolRegistry 快照
→ runToolAgent 调用模型
→ 模型按需调用内置、RAG、Skill 或 MCP Tool
→ 保存最终回答、工具轨迹和运行状态
→ Electron 页面刷新并发送系统通知
```

本阶段目标是实现应用运行期间可靠、可观察、可管理的 Agent 自动任务，而不是实现 Windows 服务或云端任务平台。

## 2. 与现有 MemoryScheduler 的边界

两种 Scheduler 保持独立：

- `MemoryScheduler`：系统内部记忆维护，触发条件为写入次数、每日维护和手动维护；
- `TaskScheduler`：用户创建的通用 Agent 任务，触发条件为一次性时间、固定间隔或 Cron。

两者可以复用关机屏障和原子存储模式，但不共享任务数据、运行历史和业务接口。这样避免用户任务逻辑进入记忆模块，也避免记忆维护出现在 Scheduler 用户界面。

## 3. 功能范围

Phase 10 实现：

- 创建、编辑、删除、启用和停用定时任务；
- `once`、`interval`、`cron` 三种计划；
- IANA 时区，默认 `Asia/Shanghai`；
- 计算并展示 `nextRunAt`；
- 应用运行期间自动触发；
- 启动时按策略处理错过的执行；
- 独立运行完整 Agent Loop；
- 使用运行时最新的内置、RAG、Skill 和 MCP Tool；
- 定时任务敏感工具审批；
- 单并发执行队列和同任务防重叠；
- Run Now；
- 执行历史、最终回答、工具轨迹和错误代码；
- Electron Scheduler 管理页面；
- 完成/失败系统通知；
- 事件日志、自动化测试、冒烟测试和中文学习文档；
- 与聊天、记忆和 MCP 一起优雅关闭。

Phase 10 不实现：

- Electron 完全退出后继续执行；
- Windows Task Scheduler、系统服务或开机自启；
- 多设备同步和云端调度；
- 分布式任务锁；
- 多任务并发；
- 自动创建长期记忆；
- 自动批准敏感操作；
- 任意代码、Shell 或工作流 DSL；
- 任务之间的依赖图和 DAG。

## 4. 时间模型

### 4.1 一次性任务

```ts
{ kind: "once", runAt: "2026-07-20T09:00:00+08:00" }
```

任务被调度一次后自动停用。执行失败不会自动无限重试，用户可以在历史页面查看错误并点击 Run Now。

### 4.2 固定间隔

```ts
{ kind: "interval", every: 6, unit: "hours" }
```

支持 `minutes`、`hours`、`days`，最短 5 分钟，最长 365 天。下一次时间基于上一次计划时间计算，而不是基于执行结束时间，避免慢任务持续推迟周期。

### 4.3 Cron

```ts
{
  kind: "cron",
  expression: "0 9 * * *",
  timezone: "Asia/Shanghai"
}
```

使用成熟 Cron 解析库，不自行实现日期规则。采用五字段 Cron：分钟、小时、日、月、星期；不支持秒字段。解析失败或时区无效时拒绝保存任务。

### 4.4 定时器策略

进程中只维护距离最近任务的一个 `setTimeout`。定时器触发后查询所有到期任务，按 `nextRunAt`、`createdAt`、`id` 排序放入队列，再为新的最近时间建立定时器。

任何单次 `setTimeout` 最长不超过 24 小时。更远的任务每天重新校准，避免系统睡眠、时钟变化和 JavaScript 定时器上限造成漂移。

## 5. 错过执行策略

每个任务支持：

- `skip`：应用关闭期间错过的次数不补跑，直接计算下一次未来时间；
- `run-once`：启动时若已错过，无论错过多少次只补跑一次，然后计算下一次未来时间。

默认是 `run-once`。不会为每个错过周期分别补跑，防止应用关闭几天后瞬间发起大量模型和 MCP 请求。

补跑任务与普通到期任务进入同一个单并发队列。一次性任务错过后，`run-once` 会补跑一次，`skip` 会直接标记为错过并停用。

## 6. 任务和运行数据

任务定义：

```ts
interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  schedule: OnceSchedule | IntervalSchedule | CronSchedule;
  timezone: string;
  missedRunPolicy: "skip" | "run-once";
  enabled: boolean;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

运行记录：

```ts
interface ScheduledTaskRun {
  id: string;
  taskId: string;
  trigger: "scheduled" | "catch-up" | "manual";
  status: "queued" | "running" | "succeeded" | "failed" | "needs_attention" | "skipped_overlap" | "cancelled_shutdown";
  scheduledFor: string;
  startedAt?: string;
  finishedAt?: string;
  reply?: string;
  toolCalls: ScheduledToolCallRecord[];
  errorCode?: string;
}
```

工具轨迹只保存工具 ID、参数的安全副本、结果摘要、时间、是否需要审批和最终状态。沿用 AgentEvent 的安全过滤规则，不保存 Token、Authorization Header 或 MCP 环境变量值。

任务配置存入 `scheduled-tasks.json`，运行历史存入 `scheduled-task-runs.json`，均使用版本字段、严格校验和原子写入。最多保留全局最近 500 条、每个任务最近 100 条记录，超出时删除最旧记录。

## 7. Scheduled Agent Runner

每次执行使用全新的临时对话，不复用当前聊天窗口历史：

```text
system: 当前人格基础提示 + Skill Catalog + 相关长期记忆 + 定时任务执行规则
user: 任务 prompt
```

运行时行为：

- 使用当前模型配置；
- 使用当前人格，但不消费或修改聊天中的一次性人格切换提醒；
- 根据任务 Prompt 召回相关长期记忆；
- 提供当前已启用 Skills；
- 每次执行获取最新 ToolRegistry 快照，因此新连接或断开的 MCP 会自然生效；
- 使用现有 `runToolAgent`，默认最多五轮；
- 单次运行总超时 10 分钟；
- 保存最终回答和工具轨迹；
- 不写入 ChatSession；
- 不触发自动长期记忆提取，避免周期报告被误认为用户长期事实。

定时任务 Prompt 前增加稳定、简短的运行规则，告诉模型这是无人值守任务、应明确报告数据来源和失败、不得假装执行未成功的动作。任务 Prompt 本身仍以 `user` 消息传入，不混进 System Prompt。

## 8. MCP 与敏感操作

自动到期和补跑任务不会因为 MCP Server 被标记为 `trusted` 而静默执行敏感工具。执行上下文增加 `executionMode: "interactive" | "scheduled"`：

- 普通聊天和用户点击 Scheduler 的 Run Now 使用 `interactive`；
- 自动到期和启动补跑使用 `scheduled`；
- `scheduled + read` 直接执行；
- `scheduled + sensitive` 必须请求 Renderer 审批；
- 没有可接收审批的窗口时立即拒绝，不后台等待；
- 有窗口时显示任务名称、Server、Tool 和安全参数，最多等待 60 秒；
- 用户批准后只允许当前这一次调用；
- 超时或拒绝后工具返回明确错误，Agent 可以生成说明，运行状态记为 `needs_attention`；
- 用户可以从历史页面点击 Run Now 重新执行整项任务并正常处理审批。

敏感调用不会在任务配置中获得永久自动批准选项。本阶段也不实现保存并恢复半途中断的 Agent 对话。

## 9. 队列与并发

所有定时运行进入一个 FIFO 队列，全局并发数为 1。理由是控制 API 成本、MCP 并发风险和关机复杂度。

同一任务处于 `queued` 或 `running` 时再次到期，新触发记录为 `skipped_overlap`，不会重复排队。不同任务会正常排队。

Scheduler 对任务增删改操作串行化，沿用 MCP Manager 的 operation tail 模式，防止界面连续操作造成计时器和文件状态不一致。

## 10. 模块划分

新增 `src/main/scheduler/`：

```text
scheduled-task-types.ts          数据契约
scheduled-task-validation.ts     运行时严格校验
scheduled-task-store.ts          任务原子存储
scheduled-run-store.ts           运行历史和保留策略
schedule-calculator.ts           once/interval/cron时间计算
scheduled-task-queue.ts          单并发队列和防重叠
scheduled-agent-runner.ts        独立Agent执行
task-scheduler.ts                计时器、补跑和生命周期
create-scheduler-runtime.ts      生产组装和关机接口
```

Electron 边界：

```text
src/main/app/register-scheduler-ipc.ts
src/shared/scheduler-api-types.ts
src/renderer/chat/scheduler-view-model.ts
src/renderer/chat/scheduler-view.ts
```

`main.ts` 只负责组装 Scheduler Runtime、注册 IPC、提供模型/Prompt/记忆/工具依赖并加入统一关机，不承载调度业务逻辑。

## 11. IPC 与界面

Preload 只暴露固定 API：

```text
listTasks
createTask
updateTask
deleteTask
setTaskEnabled
runTaskNow
listRuns
getRun
onSchedulerChanged
```

Scheduler 页面包含：

- 任务列表：名称、规则、状态、下次运行、最近结果；
- 新建/编辑表单：任务 Prompt、once/interval/cron、时区、错过策略；
- 启用开关、Run Now、编辑和删除命令；
- 历史列表：触发方式、状态、耗时、回答摘要；
- 运行详情：完整回答、工具轨迹和错误代码。

界面不允许用户直接编辑 Cron 派生的 `nextRunAt`。所有下一次时间由 Main 计算，Renderer 只负责展示。

## 12. 事件和通知

新增事件：

```text
scheduled_task_queued
scheduled_task_started
scheduled_task_tool_blocked
scheduled_task_finished
scheduled_task_failed
scheduled_task_skipped
```

事件在终端和 Electron Agent Events 中使用安全摘要。任务成功、失败或需要注意时发送 Electron 系统通知；点击通知打开 Scheduler 页面并定位对应运行记录。

## 13. 关机语义

应用开始退出后：

1. Scheduler 停止接受新管理操作和 Run Now；
2. 清除唤醒定时器；
3. 尚未开始的队列项标记为 `cancelled_shutdown`；
4. 当前运行最多等待 10 秒完成；
5. 超时后保存失败状态并继续退出，不永久阻塞 Electron；
6. 将 Scheduler 的 pending count 和 shutdown Promise 加入现有统一关机 Runtime；
7. MCP Runtime 在 Scheduler 停止使用工具后再关闭连接。

## 14. 错误处理

使用稳定错误码而不是把内部异常直接暴露到界面：

```text
SCHEDULE_CONFIG_INVALID
SCHEDULE_TIME_INVALID
SCHEDULE_TASK_NOT_FOUND
SCHEDULE_TASK_DISABLED
SCHEDULE_RUN_OVERLAP
SCHEDULE_MODEL_CONFIG_INVALID
SCHEDULE_AGENT_TIMEOUT
SCHEDULE_APPROVAL_UNAVAILABLE
SCHEDULE_SHUTTING_DOWN
SCHEDULE_STORE_FAILED
```

单个任务失败不会停止 Scheduler。存储失败时不声称任务已保存；更新失败需要保留旧任务和旧定时器。应用启动遇到损坏文件时隔离损坏文件并使用空任务列表，同时记录可见错误事件。

## 15. 测试策略

单元测试覆盖：

- 三种时间规则和时区；
- 夏令时边界；
- 配置限制与损坏文件隔离；
- `skip` 和 `run-once`；
- 单定时器重排；
- 队列顺序、防重叠和关闭；
- 历史保留策略；
- 敏感 MCP 工具在 scheduled 模式下强制审批；
- Run Now 使用 interactive 模式；
- Renderer ViewModel 和表单行为。

集成测试使用假时钟和假模型验证：

```text
任务到期
→ Agent看到最新ToolRegistry
→ 调用只读工具
→ 保存role=tool之后的最终回答
→ 写入成功历史
```

另一个集成测试验证敏感 MCP 工具不会因 trusted 配置静默执行。Electron 冒烟测试验证 Scheduler 页在桌面和窄窗口中可用，并能创建一次性任务、Run Now、看到历史结果和删除任务。

## 16. 完成标准

Phase 10 只有在以下条件全部满足后才标记完成：

- 三种规则能正确计算并触发；
- 重启能恢复任务并按策略处理错过执行；
- 自动任务能运行真实 Agent Loop 和只读 MCP Tool；
- 敏感 MCP Tool 不会静默执行；
- 任务不污染聊天会话和长期记忆；
- 历史、通知、IPC 和 UI 可用；
- 关机不会丢失已接受状态或永久卡住；
- 单元、集成、构建和 Electron 冒烟测试通过；
- 中文学习文档完整说明时间模型、队列、自动 Agent 和安全边界。
