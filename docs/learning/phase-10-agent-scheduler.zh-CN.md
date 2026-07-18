# Phase 10：Agent 定时任务系统

## 1. 这一阶段解决什么问题

此前 Agent 只能在用户发送消息后工作。Phase 10 加入 Scheduler（调度器），使用户可以提前保存一项任务，并让应用在指定时间自动启动一次独立 Agent Loop。

支持三种时间规则：

- `once`：只在某个时间执行一次。
- `interval`：每隔若干分钟、小时或天执行。
- `cron`：使用五段 Cron 表达式描述重复时间，例如 `0 9 * * 1-5` 表示工作日上午 9 点。

## 2. 一次定时任务的完整流程

```text
Renderer 的 Tasks 页面
  -> window.cyrene.scheduler.createTask(...)
  -> Preload 使用固定 IPC Channel
  -> register-scheduler-ipc 校验参数
  -> TaskScheduler 计算 nextRunAt
  -> ScheduledTaskStore 原子写入 scheduled-tasks.json
  -> 到点后 ScheduledTaskQueue 排队
  -> ScheduledAgentRunner 组装 system + user messages
  -> runToolAgent 执行模型和工具循环
  -> ScheduledRunStore 保存状态、回答和工具轨迹
  -> Renderer 收到 changed 事件并刷新
  -> Electron 显示系统通知
```

这里没有一个 `while(true)` 不停检查时间。`TaskScheduler` 找到最近的 `nextRunAt`，只设置一个计时器；计时器触发后处理到期任务，再重新计算下一个时间。

## 3. 文件按职责划分

### 数据契约与校验

- `scheduled-task-types.ts`：定义任务、时间规则、运行记录、工具记录的 TypeScript 结构。
- `scheduled-task-validation.ts`：用 Zod 校验外部数据，限制名称、Prompt、时区、Cron 和间隔范围。
- `scheduler-api-types.ts`：规定 Renderer 与 Main 之间可交换的数据和可调用方法。

### 时间计算

- `schedule-calculator.ts`：计算下一次执行时间，处理时区、夏令时和错过执行。
- Cron 使用成熟的 `cron-parser`，没有自行实现解析器。

### 持久化

- `scheduled-task-store.ts`：读写任务配置 `scheduled-tasks.json`。
- `scheduled-run-store.ts`：读写执行历史 `scheduled-runs.json`，每个任务最多保留 100 条，全局最多 500 条。
- 写文件采用临时文件加重命名的原子写入方式，尽量避免应用中途退出留下半个 JSON。

### 排队与执行

- `scheduled-task-queue.ts`：全局并发数为 1，同一个任务不允许重叠执行。
- `scheduled-agent-runner.ts`：为任务建立独立消息数组并调用现有 `runToolAgent`。
- `task-scheduler.ts`：系统核心，负责 CRUD、计时、补跑、排队、立即运行和关闭。
- `create-scheduler-runtime.ts`：把 Store、Queue 和 Scheduler 组装成生产运行实例。

### Electron 边界与界面

- `register-scheduler-ipc.ts`：Main 端的 IPC Handler，只接受固定字段并转交 Scheduler。
- `preload/index.ts`：向 Renderer 暴露 `window.cyrene.scheduler`，Renderer 不获得 Node.js 权限。
- `scheduler-view.ts`：创建表单、任务列表、启停/立即执行/删除按钮和运行历史。
- `scheduler-view-model.ts`：把内部状态转换为适合显示的文字。

## 4. 定时运行如何组成 Prompt

定时运行不是接着当前聊天会话继续，而是创建一个隔离的消息数组：

```ts
[
  { role: "system", content: systemPrompt },
  { role: "user", content: task.prompt },
]
```

`systemPrompt` 包含当前人格、可用 Skill 目录、根据任务 Prompt 召回的长期记忆，以及“这是独立定时任务”的运行说明。隔离的好处是定时任务不会污染当前聊天历史，也不会把其他任务的上下文带进来。

## 5. 自动运行与 Run Now 的区别

- 到点自动运行使用 `executionMode: "scheduled"`。
- 用户点击 Run Now 使用 `executionMode: "interactive"`。

两者运行同一个 Agent Loop。主要区别是敏感 MCP 工具：自动执行时即使服务器被标记为 trusted，也必须经过审批。没有可用审批窗口时，运行记录变为 `needs_attention`，而不是静默获得高风险权限。

## 6. 运行状态

- `queued`：已进入队列。
- `running`：Agent Loop 正在运行。
- `succeeded`：正常完成。
- `failed`：模型、超时或内部执行失败。
- `needs_attention`：任务完成了一部分，但敏感工具需要人工处理。
- `skipped_overlap`：同一任务已有一次运行，新的执行被跳过。
- `cancelled_shutdown`：应用退出时，尚未开始的任务被取消。

每条运行记录保存触发方式、计划时间、开始/结束时间、最终回答、错误码，以及经过脱敏的工具参数和结果摘要。

## 7. 错过时间如何处理

应用关闭时无法执行任务。下次启动后：

- `run-once`：最多补跑一次，然后把下一次时间推进到未来。
- `skip`：不补跑，直接计算未来下一次时间。

这种设计避免应用离线很久后一次补跑几十次。

## 8. 如何测试

纯调度冒烟测试不调用真实模型：

```bash
npm run test:scheduler
```

完整单元测试、类型检查和构建：

```bash
npm test
npm run typecheck
npm run build
```

Electron 端到端冒烟测试会启动临时 Electron，创建一个未来任务，打开 Tasks 页面确认它可见，然后删除：

```bash
npm run test:electron-smoke
```

手动测试时运行 `npm run dev:electron`，打开 Tasks，创建一个至少五分钟间隔的任务，再点击 Run Now。运行历史会依次显示 queued、running 和最终状态；Agent Events 区域会显示调度事件及内部 Agent Loop 事件。

## 9. 需要特别理解的设计选择

1. Scheduler 只负责“何时运行”，Agent Runner 负责“怎样运行”。
2. Store 只负责持久化，不参与时间计算。
3. IPC 只传递经过校验的命令，不把 Scheduler 对象直接暴露给页面。
4. 每次定时执行拥有独立消息历史，但共享当前配置、工具、Skill 和长期记忆。
5. 自动化不会绕过已有安全边界，尤其不会静默放行敏感 MCP 工具。
