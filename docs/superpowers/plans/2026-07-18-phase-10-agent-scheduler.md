# Phase 10 Agent Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent once, interval, and cron schedules that run isolated Agent jobs with current Skills, memory recall, and MCP tools while preserving interactive approval and shutdown safety.

**Architecture:** A focused `src/main/scheduler` domain owns validation, time calculation, atomic stores, a single-concurrency queue, Agent execution, and timer lifecycle. Electron IPC and Renderer surfaces manage tasks and inspect runs; production assembly injects current model, prompt, memory, ToolRegistry, approval, notification, and shutdown dependencies.

**Tech Stack:** TypeScript, Node.js 22 LTS, Electron 43, Vitest, Vite, Zod 4, `cron-parser`, existing Agent Loop, memory/RAG, Skills, and MCP runtime.

## Global Constraints

- Work directly on `main`; do not create a feature branch or use subagents.
- Keep `MemoryScheduler` and user-facing `TaskScheduler` separate.
- Support only `once`, `interval`, and five-field `cron`; default timezone is `Asia/Shanghai`.
- The scheduler runs only while Electron is running; do not add OS services, autostart, cloud sync, DAGs, shell execution, or multiple concurrent runs.
- Default missed-run policy is `run-once`; never replay every missed occurrence.
- Automatic scheduled runs never inherit silent approval from a trusted MCP server.
- Scheduled runs use isolated messages, do not mutate `ChatSession`, and do not write automatic long-term memories.
- Retain at most 500 runs globally and 100 runs per task.
- Use TDD, focused files, atomic JSON writes, safe event payloads, and one commit per task.

---

## File Map

Create `src/main/scheduler/`:

- `scheduled-task-types.ts`: task, schedule, run, trigger, and status contracts.
- `scheduled-task-validation.ts`: strict runtime parsing and limits.
- `schedule-calculator.ts`: next-time and missed-run calculations.
- `scheduled-task-store.ts`: versioned atomic task persistence.
- `scheduled-run-store.ts`: versioned atomic run persistence and retention.
- `scheduled-task-queue.ts`: FIFO single-concurrency queue and per-task overlap guard.
- `scheduled-agent-runner.ts`: isolated Agent Loop execution and trace capture.
- `task-scheduler.ts`: due detection, timer re-arming, catch-up, CRUD, and lifecycle.
- `create-scheduler-runtime.ts`: production assembly and shutdown facade.

Create Electron boundaries:

- `src/shared/scheduler-api-types.ts`
- `src/main/app/register-scheduler-ipc.ts`
- `src/renderer/chat/scheduler-view-model.ts`
- `src/renderer/chat/scheduler-view.ts`

Create tests in `tests/scheduler/`, plus focused Main, Renderer, integration, and Electron smoke coverage.

---

### Task 1: Scheduler Domain Types and Strict Validation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/main/scheduler/scheduled-task-types.ts`
- Create: `src/main/scheduler/scheduled-task-validation.ts`
- Test: `tests/scheduler/scheduled-task-validation.test.ts`

**Interfaces:**
- Produces: `ScheduledTask`, `ScheduledTaskInput`, `ScheduledTaskRun`, `ScheduledToolCallRecord`, `parseScheduledTask()`, `parseScheduledTasksFile()`, and `parseScheduledRunsFile()`.
- Consumes: Zod and ISO date strings; later tasks must use these exact parsed types.

- [ ] **Step 1: Install the Cron dependency**

Run:

```powershell
npm.cmd install cron-parser
```

Expected: `cron-parser` appears in dependencies and the lock file changes.

- [ ] **Step 2: Write failing validation tests**

Cover exact-object rejection, ID/name/prompt limits, valid once/interval/cron unions, five-field cron enforcement, interval range `5 minutes` through `365 days`, default `Asia/Shanghai`, unique task IDs, valid run statuses, and rejection of unknown keys.

Representative assertion:

```ts
expect(parseScheduledTask({
  id: "daily-github",
  name: "Daily GitHub",
  prompt: "Summarize repository activity",
  schedule: { kind: "cron", expression: "0 9 * * *" },
  timezone: "Asia/Shanghai",
  missedRunPolicy: "run-once",
  enabled: true,
  nextRunAt: "2026-07-19T01:00:00.000Z",
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
})).toMatchObject({ id: "daily-github" });
```

- [ ] **Step 3: Run the test and confirm RED**

Run: `npm.cmd test -- tests/scheduler/scheduled-task-validation.test.ts`

Expected: FAIL because scheduler validation modules do not exist.

- [ ] **Step 4: Implement types and Zod parsers**

Use discriminated unions:

```ts
export type TaskSchedule =
  | { kind: "once"; runAt: string }
  | { kind: "interval"; every: number; unit: "minutes" | "hours" | "days" }
  | { kind: "cron"; expression: string };

export type ScheduledRunStatus =
  | "queued" | "running" | "succeeded" | "failed"
  | "needs_attention" | "skipped_overlap" | "cancelled_shutdown";
```

Validate timezone with `Intl.DateTimeFormat(undefined, { timeZone })`. In this task, require exactly five non-empty Cron fields; Task 2 replaces that structural check with full `cron-parser` validation through the shared calculator API.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
npm.cmd test -- tests/scheduler/scheduled-task-validation.test.ts
npm.cmd run typecheck
git add package.json package-lock.json src/main/scheduler/scheduled-task-types.ts src/main/scheduler/scheduled-task-validation.ts tests/scheduler/scheduled-task-validation.test.ts
git commit -m "feat: define scheduled task contracts"
```

Expected: focused tests and typecheck pass.

---

### Task 2: Deterministic Schedule Calculation

**Files:**
- Create: `src/main/scheduler/schedule-calculator.ts`
- Modify: `src/main/scheduler/scheduled-task-validation.ts`
- Test: `tests/scheduler/schedule-calculator.test.ts`

**Interfaces:**
- Produces: `validateSchedule(schedule, timezone): void`, `nextOccurrence(schedule, timezone, after): Date | undefined`, and `resolveMissedTask(task, now): { due: boolean; nextRunAt?: string; disable: boolean }`.
- Consumes: `TaskSchedule`, `cron-parser` `CronExpressionParser`, and injected reference dates.

- [ ] **Step 1: Write failing clock tests**

Test once before/after `runAt`, interval anchoring to the previous scheduled time, daily Cron in `Asia/Shanghai`, DST transitions in `America/New_York`, five-field rejection, `skip`, `run-once`, and one-shot disabling.

```ts
expect(nextOccurrence(
  { kind: "cron", expression: "0 9 * * *" },
  "Asia/Shanghai",
  new Date("2026-07-18T02:00:00.000Z"),
)?.toISOString()).toBe("2026-07-19T01:00:00.000Z");
```

- [ ] **Step 2: Confirm RED**

Run: `npm.cmd test -- tests/scheduler/schedule-calculator.test.ts`

Expected: FAIL because calculator exports are missing.

- [ ] **Step 3: Implement calculations**

Use:

```ts
const interval = CronExpressionParser.parse(expression, {
  currentDate: after,
  tz: timezone,
});
return interval.next().toDate();
```

Reject expressions whose trimmed whitespace split is not exactly five fields before calling the library. For interval schedules, convert the unit to milliseconds and advance from the stored planned time until the result is strictly after the reference time; do not emit every skipped point.

- [ ] **Step 4: Connect validation and verify**

Run:

```powershell
npm.cmd test -- tests/scheduler/schedule-calculator.test.ts tests/scheduler/scheduled-task-validation.test.ts
npm.cmd run typecheck
git add src/main/scheduler/schedule-calculator.ts src/main/scheduler/scheduled-task-validation.ts tests/scheduler
git commit -m "feat: calculate scheduled task times"
```

Expected: time and validation tests pass without real timers.

---

### Task 3: Atomic Task and Run Stores

**Files:**
- Create: `src/main/scheduler/scheduled-task-store.ts`
- Create: `src/main/scheduler/scheduled-run-store.ts`
- Test: `tests/scheduler/scheduled-task-store.test.ts`
- Test: `tests/scheduler/scheduled-run-store.test.ts`

**Interfaces:**
- Produces: `ScheduledTaskStore` with `load()` and `save(tasks)`; `ScheduledRunStore` with `load()`, `append(run)`, and `update(id, updater)`.
- Consumes: `writeFileAtomically`, validation parsers, global retention 500, per-task retention 100.

- [ ] **Step 1: Write failing persistence tests**

Assert missing files return empty arrays, valid files round-trip, invalid files are renamed with `.corrupt-<timestamp>`, saves include `schemaVersion: 1`, concurrent updates serialize, and retention removes oldest runs deterministically.

- [ ] **Step 2: Confirm RED**

Run: `npm.cmd test -- tests/scheduler/scheduled-task-store.test.ts tests/scheduler/scheduled-run-store.test.ts`

Expected: FAIL because stores do not exist.

- [ ] **Step 3: Implement stores**

Follow `mcp-config-store.ts` for quarantine and `memory-store.ts` for serialized update tails. Run retention after sorting by `startedAt ?? scheduledFor`, then `id`; apply per-task 100 before global 500.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm.cmd test -- tests/scheduler/scheduled-task-store.test.ts tests/scheduler/scheduled-run-store.test.ts
npm.cmd run typecheck
git add src/main/scheduler/scheduled-task-store.ts src/main/scheduler/scheduled-run-store.ts tests/scheduler
git commit -m "feat: persist scheduled tasks and runs"
```

---

### Task 4: Single-Concurrency Queue and Overlap Guard

**Files:**
- Create: `src/main/scheduler/scheduled-task-queue.ts`
- Test: `tests/scheduler/scheduled-task-queue.test.ts`

**Interfaces:**
- Produces: `ScheduledTaskQueue.enqueue(input): Promise<"queued" | "overlap">`, `beginShutdown()`, `flush()`, and `pendingCount()`.
- Consumes: jobs shaped as `{ taskId, runId, run(): Promise<void>, cancel(): Promise<void> }`.

- [ ] **Step 1: Write failing queue tests**

Assert FIFO order, only one active job, a second queued/running job with the same `taskId` returns `overlap`, different tasks queue, rejected jobs do not stop the tail, shutdown rejects new work, queued jobs invoke `cancel`, and flush waits for the active job.

- [ ] **Step 2: Confirm RED**

Run: `npm.cmd test -- tests/scheduler/scheduled-task-queue.test.ts`

- [ ] **Step 3: Implement the queue**

Use one explicit pending array and one drain Promise. Track task IDs across active and queued work; remove IDs in `finally`. Do not use parallel `Promise.all` for jobs.

- [ ] **Step 4: Verify and commit**

```powershell
npm.cmd test -- tests/scheduler/scheduled-task-queue.test.ts
npm.cmd run typecheck
git add src/main/scheduler/scheduled-task-queue.ts tests/scheduler/scheduled-task-queue.test.ts
git commit -m "feat: queue scheduled agent runs"
```

---

### Task 5: Scheduled Agent Execution and MCP Approval Context

**Files:**
- Modify: `src/main/agent/tool-agent.ts`
- Modify: `src/main/tools/tool-types.ts`
- Modify: `src/main/mcp/mcp-tool-adapter.ts`
- Create: `src/main/scheduler/scheduled-agent-runner.ts`
- Test: `tests/agent/tool-agent.test.ts`
- Test: `tests/mcp/mcp-tool-adapter.test.ts`
- Test: `tests/scheduler/scheduled-agent-runner.test.ts`

**Interfaces:**
- Produces: `AgentExecutionMode = "interactive" | "scheduled"`; `runToolAgent({ executionMode })`; `ScheduledAgentRunner.run(input): Promise<ScheduledAgentRunResult>`.
- Consumes: current prompt composer, model config, memory recall, Skill catalog, ToolRegistry factory, `runToolAgent`, and event callback.

- [ ] **Step 1: Write failing execution-mode tests**

Assert default mode remains interactive, execution context reaches `ToolDefinition.execute`, a trusted sensitive MCP tool still asks in scheduled mode, read MCP tools execute directly, and interactive trusted behavior remains unchanged.

```ts
await runToolAgent({
  messages,
  config,
  adapter,
  toolRegistry,
  executionMode: "scheduled",
});
expect(seenContext.executionMode).toBe("scheduled");
```

- [ ] **Step 2: Confirm RED**

Run: `npm.cmd test -- tests/agent/tool-agent.test.ts tests/mcp/mcp-tool-adapter.test.ts`

- [ ] **Step 3: Add execution mode**

Extend `ToolExecutionContext` with `executionMode`. In `adaptMcpTool`, force `ask` when `context?.executionMode === "scheduled" && risk === "sensitive"`; otherwise preserve `policyForMcpTool(risk, server.trust)`.

- [ ] **Step 4: Write failing runner tests**

Assert messages contain one system and one user task prompt, relevant memory enters only system context, tool snapshots are fresh per run, AgentEvent tools become safe `ScheduledToolCallRecord` values, a sensitive denial produces `needs_attention`, timeout becomes `SCHEDULE_AGENT_TIMEOUT`, and no ChatSession or memory-write dependency exists.

- [ ] **Step 5: Implement the runner**

Define injected dependencies instead of importing Electron:

```ts
export interface ScheduledAgentRunnerOptions {
  composeSystemPrompt(input: { prompt: string }): Promise<string>;
  createToolRegistry(): ToolRegistry;
  getModelConfig(): ModelConfig;
  runAgent?: typeof runToolAgent;
  timeoutMs?: number;
  onEvent?: (runId: string, event: AgentEvent) => void;
}
```

Race the Agent Promise against a 10-minute timer, collect tool start/finish events, and classify permission denial or approval timeout as `needs_attention`.

- [ ] **Step 6: Verify and commit**

```powershell
npm.cmd test -- tests/agent/tool-agent.test.ts tests/mcp/mcp-tool-adapter.test.ts tests/scheduler/scheduled-agent-runner.test.ts
npm.cmd run typecheck
git add src/main/agent src/main/tools/tool-types.ts src/main/mcp/mcp-tool-adapter.ts src/main/scheduler/scheduled-agent-runner.ts tests
git commit -m "feat: run isolated scheduled agents"
```

---

### Task 6: Task Scheduler Orchestration

**Files:**
- Create: `src/main/scheduler/task-scheduler.ts`
- Test: `tests/scheduler/task-scheduler.test.ts`
- Test: `tests/integration/scheduled-agent-task.test.ts`

**Interfaces:**
- Produces: `TaskScheduler.initialize()`, `snapshot()`, `create()`, `update()`, `remove()`, `setEnabled()`, `runNow()`, `listRuns()`, `getRun()`, `beginShutdown()`, and `pendingCount()`.
- Consumes: task/run stores, calculator, queue, runner, injected `now`, `setTimer`, `clearTimer`, IDs, events, and notifications.

- [ ] **Step 1: Write failing lifecycle tests with a fake clock**

Cover initial load, one timer for the nearest task, 24-hour timer cap, due ordering, timer re-arm after CRUD, once disabling, interval anchoring, Cron next time, `skip`, one catch-up for `run-once`, overlap history, runner success/failure, and store rollback when persistence fails.

- [ ] **Step 2: Confirm RED**

Run: `npm.cmd test -- tests/scheduler/task-scheduler.test.ts`

- [ ] **Step 3: Implement orchestration**

Keep configuration mutations on an operation tail. Persist the updated task and `nextRunAt` before reporting success. For each accepted trigger, append `queued`, let the queue transition to `running`, then save terminal status in `finally` and re-arm the timer.

- [ ] **Step 4: Write and pass the Agent integration test**

Use a fake model that requests a read tool in round one and answers in round two. Assert the stored run includes the final reply and tool call, while the normal ChatSession fixture remains unchanged.

- [ ] **Step 5: Verify and commit**

```powershell
npm.cmd test -- tests/scheduler/task-scheduler.test.ts tests/integration/scheduled-agent-task.test.ts
npm.cmd run typecheck
git add src/main/scheduler/task-scheduler.ts tests/scheduler/task-scheduler.test.ts tests/integration/scheduled-agent-task.test.ts
git commit -m "feat: schedule persistent agent tasks"
```

---

### Task 7: Shared API, IPC, Preload, and Events

**Files:**
- Create: `src/shared/scheduler-api-types.ts`
- Modify: `src/shared/electron-api.ts`
- Modify: `src/shared/ipc-channels.ts`
- Create: `src/main/app/register-scheduler-ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/agent/agent-events.ts`
- Modify: `src/renderer/chat/renderer-events.ts`
- Test: `tests/shared/electron-api.test.ts`
- Test: `tests/shared/ipc-channels.test.ts`
- Test: `tests/main/register-scheduler-ipc.test.ts`
- Test: `tests/agent/agent-events.test.ts`
- Test: `tests/renderer/renderer-events.test.ts`

**Interfaces:**
- Produces: `window.cyrene.scheduler`, scheduler IPC channels, strict IPC parsers, safe view DTOs, and six scheduler AgentEvent variants.
- Consumes: `TaskScheduler` methods and sender broadcast hooks.

- [ ] **Step 1: Write failing contract tests**

Assert exact channel names, all API methods, strict payload rejection, safe error messages, handler disposal, shutdown rejection, and event formatting.

- [ ] **Step 2: Confirm RED**

```powershell
npm.cmd test -- tests/shared tests/main/register-scheduler-ipc.test.ts tests/agent/agent-events.test.ts tests/renderer/renderer-events.test.ts
```

- [ ] **Step 3: Implement contracts and IPC**

Add channels under `IPC_CHANNELS.scheduler`: `listTasks`, `createTask`, `updateTask`, `removeTask`, `setEnabled`, `runNow`, `listRuns`, `getRun`, and `changed`. Expose matching Preload wrappers only; never expose stores or scheduler objects.

- [ ] **Step 4: Add safe events**

Add `scheduled_task_queued`, `scheduled_task_started`, `scheduled_task_tool_blocked`, `scheduled_task_finished`, `scheduled_task_failed`, and `scheduled_task_skipped`. Use task/run IDs, counts, durations, and stable codes; do not include raw prompt, authorization, or full tool results.

- [ ] **Step 5: Verify and commit**

```powershell
npm.cmd test -- tests/shared tests/main/register-scheduler-ipc.test.ts tests/agent/agent-events.test.ts tests/renderer/renderer-events.test.ts
npm.cmd run typecheck
git add src/shared src/main/app/register-scheduler-ipc.ts src/preload/index.ts src/main/agent/agent-events.ts src/renderer/chat/renderer-events.ts tests
git commit -m "feat: expose scheduler through Electron IPC"
```

---

### Task 8: Electron Scheduler Management Interface

**Files:**
- Create: `src/renderer/chat/scheduler-view-model.ts`
- Create: `src/renderer/chat/scheduler-view.ts`
- Modify: `src/renderer/chat/index.html`
- Modify: `src/renderer/chat/main.ts`
- Modify: `src/renderer/chat/style.css`
- Test: `tests/renderer/scheduler-view-model.test.ts`
- Test: `tests/renderer/scheduler-view.test.ts`

**Interfaces:**
- Produces: Scheduler tab, task editor, task list, run history, run detail, and responsive controls.
- Consumes: `window.cyrene.scheduler` and shared view DTOs.

- [ ] **Step 1: Write failing ViewModel tests**

Test stable task/run sorting, local time formatting, schedule labels, status labels, next-run fallback, action availability, and safe duration formatting.

- [ ] **Step 2: Write failing view behavior tests**

Test create/edit forms for all schedule kinds, conditional fields, validation feedback, enable, Run Now, delete, history selection, detail rendering, change-event refresh, and disposal.

- [ ] **Step 3: Confirm RED**

Run: `npm.cmd test -- tests/renderer/scheduler-view-model.test.ts tests/renderer/scheduler-view.test.ts`

- [ ] **Step 4: Implement the interface**

Add a `Scheduler` tab beside MCP. Use an unframed workspace with compact rows; cards are allowed only for repeated task/run items. Use Lucide only if an icon package is already present; otherwise use accessible text commands to avoid adding an icon dependency solely for this phase. Ensure fixed control dimensions and responsive form tracks.

- [ ] **Step 5: Verify and commit**

```powershell
npm.cmd test -- tests/renderer/scheduler-view-model.test.ts tests/renderer/scheduler-view.test.ts
npm.cmd run build
git add src/renderer tests/renderer
git commit -m "feat: add Electron scheduler interface"
```

---

### Task 9: Production Runtime, Notifications, and Unified Shutdown

**Files:**
- Create: `src/main/scheduler/create-scheduler-runtime.ts`
- Modify: `src/main/app/main.ts`
- Modify: `src/main/app/register-memory-ipc.ts`
- Modify: `src/main/app/background-memory-shutdown.ts`
- Test: `tests/scheduler/create-scheduler-runtime.test.ts`
- Test: `tests/main/register-memory-ipc.test.ts`
- Test: `tests/main/background-memory-shutdown.test.ts`
- Test: `tests/integration/scheduled-mcp-policy.test.ts`

**Interfaces:**
- Produces: `SchedulerRuntime` with `scheduler`, `shutdown()`, and `pendingBackgroundTaskCount()`.
- Consumes: userData paths, prompt/persona/Skill/memory services, current ToolRegistry snapshots, model config, Electron `Notification`, event broadcast, and MCP approval.

- [ ] **Step 1: Write failing assembly and shutdown tests**

Assert runtime initializes stores before arming timers, fresh ToolRegistry is requested per run, scheduler shutdown begins before MCP shutdown, pending counts include Scheduler, a handled scheduler failure cannot permanently block quit, and notification payloads contain no prompt or tool result.

- [ ] **Step 2: Confirm RED**

```powershell
npm.cmd test -- tests/scheduler/create-scheduler-runtime.test.ts tests/main/register-memory-ipc.test.ts tests/main/background-memory-shutdown.test.ts tests/integration/scheduled-mcp-policy.test.ts
```

- [ ] **Step 3: Assemble production dependencies**

Create stores under Electron userData, compose the selected persona without consuming chat transitions, build Skill Catalog, recall memory from the task prompt, and inject `() => mcpRuntime.manager.createToolRegistrySnapshot()`.

Order shutdown as:

```text
close Scheduler acceptance
→ drain/cancel Scheduler work
→ close chat and memory work
→ close MCP connections
```

- [ ] **Step 4: Add notification behavior**

Send notifications for `succeeded`, `failed`, and `needs_attention`. Store the selected run ID so notification clicks activate/create the Main window, switch to Scheduler, and request run selection through the Scheduler changed channel.

- [ ] **Step 5: Verify and commit**

```powershell
npm.cmd test -- tests/scheduler tests/main/register-memory-ipc.test.ts tests/main/background-memory-shutdown.test.ts tests/integration/scheduled-mcp-policy.test.ts
npm.cmd run typecheck
npm.cmd run build
git add src/main src/shared tests
git commit -m "feat: integrate scheduled agents with Electron"
```

---

### Task 10: Acceptance Fixtures, Electron Smoke, Learning Guide, and Final Verification

**Files:**
- Create: `scripts/scheduler-smoke.ts`
- Modify: `scripts/electron-smoke.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/learning/00-overall-replica-roadmap.zh-CN.md`
- Create: `docs/learning/phase-10-agent-scheduler.zh-CN.md`

**Interfaces:**
- Produces: deterministic scheduler acceptance, desktop regression coverage, user instructions, and Phase 10 completion evidence.
- Consumes: fake clock hooks in Scheduler, existing MCP fixture, Electron CDP smoke harness, and all public Scheduler APIs.

- [ ] **Step 1: Add a deterministic scheduler smoke script**

Add:

```json
"test:scheduler": "tsx scripts/scheduler-smoke.ts"
```

The script must use temporary stores and a fake model/tool to create one once task, trigger it, assert two Agent rounds and one tool result, restart the runtime, verify persisted history, and remove temporary data.

- [ ] **Step 2: Extend Electron smoke**

Use isolated userData. Open Scheduler, create a future once task through the real Preload API, assert row and next-run display, invoke Run Now with deterministic test dependencies, inspect successful history/detail, delete the task, and assert no horizontal overflow at desktop and narrow viewport.

- [ ] **Step 3: Write the Chinese learning guide**

Explain in plain language first, then map to timer, Cron, timezone, queue, catch-up, isolated Agent messages, ToolRegistry snapshot, MCP approval, history, IPC, shutdown, and exact test commands. Include one daily GitHub report walkthrough.

- [ ] **Step 4: Update roadmap and README**

Mark Phase 10 complete only after all verification commands pass. Document that schedules run only while Electron is open and that sensitive automatic MCP calls require approval.

- [ ] **Step 5: Run complete verification**

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:mcp
npm.cmd run test:scheduler
npm.cmd run test:electron-smoke
git diff --check
git status --short
```

Expected: all tests pass; typecheck/build and three smoke commands exit `0`; `git diff --check` prints nothing; only intentional Phase 10 files remain before the final commit.

- [ ] **Step 6: Commit and push Main**

```powershell
git add README.md package.json package-lock.json scripts docs/learning src tests
git commit -m "docs: complete phase 10 agent scheduler"
git push origin main
```

Expected: local `HEAD` and `origin/main` resolve to the same commit.
