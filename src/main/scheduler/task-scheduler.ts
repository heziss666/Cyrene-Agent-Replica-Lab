import { randomUUID } from "node:crypto";
import { nextOccurrence, resolveMissedTask } from "./schedule-calculator.js";
import type { ScheduledAgentRunner } from "./scheduled-agent-runner.js";
import type { ScheduledRunStore } from "./scheduled-run-store.js";
import type { ScheduledTaskQueue } from "./scheduled-task-queue.js";
import type { ScheduledTaskStore } from "./scheduled-task-store.js";
import type {
  ScheduledRunTrigger,
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskRun,
} from "./scheduled-task-types.js";
import { parseScheduledTask, parseScheduledTaskInput } from "./scheduled-task-validation.js";
import type { AgentEvent } from "../agent/agent-events.js";

const MAX_TIMER_MS = 24 * 60 * 60 * 1_000;

export interface TaskSchedulerSnapshot {
  tasks: ScheduledTask[];
}

export interface TaskScheduler {
  initialize(): Promise<void>;
  snapshot(): TaskSchedulerSnapshot;
  create(input: ScheduledTaskInput): Promise<ScheduledTask>;
  update(id: string, patch: Partial<ScheduledTaskInput>): Promise<ScheduledTask>;
  remove(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<ScheduledTask>;
  runNow(id: string): Promise<string>;
  listRuns(taskId?: string): Promise<ScheduledTaskRun[]>;
  getRun(id: string): Promise<ScheduledTaskRun | undefined>;
  clearHistory(taskId: string): Promise<number>;
  flush(): Promise<void>;
  beginShutdown(): Promise<void>;
  pendingCount(): number;
}

export interface TaskSchedulerOptions {
  taskStore: ScheduledTaskStore;
  runStore: ScheduledRunStore;
  queue: ScheduledTaskQueue;
  runner: ScheduledAgentRunner;
  now?: () => Date;
  idFactory?: () => string;
  setTimer?: (callback: () => void, delay: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  onChanged?: () => void;
  onRunFinished?: (run: ScheduledTaskRun, task: ScheduledTask) => void;
  onEvent?: (event: AgentEvent) => void;
}

export function createTaskScheduler(options: TaskSchedulerOptions): TaskScheduler {
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as NodeJS.Timeout));
  let tasks = new Map<string, ScheduledTask>();
  let timer: unknown;
  let operation: Promise<unknown> = Promise.resolve();
  let pendingOperations = 0;
  let initialized = false;
  let shuttingDown = false;

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (shuttingDown) return Promise.reject(new Error("SCHEDULE_SHUTTING_DOWN"));
    pendingOperations += 1;
    const result = operation.then(work, work);
    operation = result.catch(() => undefined).finally(() => { pendingOperations -= 1; });
    return result;
  }

  function snapshot(): TaskSchedulerSnapshot {
    return { tasks: [...tasks.values()].sort(compareTasks).map(cloneTask) };
  }

  async function persist(): Promise<void> {
    await options.taskStore.save([...tasks.values()]);
  }

  function clearWakeup(): void {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  }

  function armWakeup(): void {
    clearWakeup();
    if (shuttingDown) return;
    const current = validNow(now()).getTime();
    const nearest = [...tasks.values()]
      .filter((task) => task.enabled && task.nextRunAt)
      .map((task) => Date.parse(task.nextRunAt!))
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0];
    if (nearest === undefined) return;
    const delay = Math.min(MAX_TIMER_MS, Math.max(0, nearest - current));
    timer = setTimer(() => {
      timer = undefined;
      void enqueue(processDue).catch(() => { armWakeup(); });
    }, delay);
  }

  function initialNextRun(task: Pick<ScheduledTask, "schedule" | "timezone" | "createdAt">): string | undefined {
    if (task.schedule.kind === "once") return new Date(task.schedule.runAt).toISOString();
    return nextOccurrence(task.schedule, task.timezone, validNow(now()))?.toISOString();
  }

  async function processDue(): Promise<void> {
    const current = validNow(now());
    const due = [...tasks.values()]
      .filter((task) => task.enabled && task.nextRunAt && Date.parse(task.nextRunAt) <= current.getTime())
      .sort(compareTasks);
    for (const task of due) {
      const scheduledFor = task.nextRunAt!;
      const advanced = resolveMissedTask({ ...task, missedRunPolicy: "run-once" }, current);
      const next = parseScheduledTask({
        ...task,
        enabled: advanced.disable ? false : task.enabled,
        ...(advanced.nextRunAt ? { nextRunAt: advanced.nextRunAt } : { nextRunAt: undefined }),
        updatedAt: current.toISOString(),
      });
      tasks.set(task.id, next);
      await persist();
      await queueRun(next, "scheduled", scheduledFor, "scheduled");
    }
    armWakeup();
    options.onChanged?.();
  }

  async function queueRun(
    task: ScheduledTask,
    trigger: ScheduledRunTrigger,
    scheduledFor: string,
    executionMode: "interactive" | "scheduled",
  ): Promise<string> {
    const runId = `run-${idFactory()}`;
    const queued: ScheduledTaskRun = {
      id: runId,
      taskId: task.id,
      trigger,
      status: "queued",
      scheduledFor,
      toolCalls: [],
    };
    await options.runStore.append(queued);
    options.onEvent?.({ type: "scheduled_task_queued", taskId: task.id, runId });
    const accepted = await options.queue.enqueue({
      taskId: task.id,
      runId,
      run: async () => {
        const startedAt = validNow(now()).toISOString();
        await options.runStore.update(runId, (run) => ({ ...run, status: "running", startedAt }));
        options.onEvent?.({ type: "scheduled_task_started", taskId: task.id, runId });
        options.onChanged?.();
        const result = await options.runner.run({ runId, task, executionMode });
        const finishedAt = validNow(now()).toISOString();
        await options.runStore.update(runId, (run) => ({
          ...run,
          status: result.status,
          finishedAt,
          toolCalls: result.toolCalls,
          ...(result.reply !== undefined ? { reply: result.reply } : {}),
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
          ...(result.agentRunId ? { agentRunId: result.agentRunId } : {}),
        }));
        const terminal = await getRun(runId);
        if (terminal) {
          if (terminal.status === "failed") {
            options.onEvent?.({ type: "scheduled_task_failed", taskId: task.id, runId, errorCode: terminal.errorCode ?? "SCHEDULE_AGENT_FAILED" });
          } else {
            options.onEvent?.({ type: "scheduled_task_finished", taskId: task.id, runId, status: terminal.status as "succeeded" | "needs_attention", toolCallCount: terminal.toolCalls.length, durationMs: Math.max(0, Date.parse(terminal.finishedAt ?? startedAt) - Date.parse(startedAt)) });
            for (const call of terminal.toolCalls.filter((item) => item.status === "blocked")) {
              options.onEvent?.({ type: "scheduled_tool_blocked", taskId: task.id, runId, toolId: call.toolId });
            }
          }
          options.onRunFinished?.(terminal, task);
        }
        options.onChanged?.();
      },
      cancel: async () => {
        await options.runStore.update(runId, (run) => ({
          ...run,
          status: "cancelled_shutdown",
          finishedAt: validNow(now()).toISOString(),
          errorCode: "SCHEDULE_SHUTTING_DOWN",
        }));
      },
    });
    if (accepted === "overlap") {
      await options.runStore.update(runId, (run) => ({
        ...run,
        status: "skipped_overlap",
        finishedAt: validNow(now()).toISOString(),
        errorCode: "SCHEDULE_RUN_OVERLAP",
      }));
      options.onEvent?.({ type: "scheduled_task_skipped", taskId: task.id, runId, reason: "overlap" });
    }
    options.onChanged?.();
    return runId;
  }

  async function getRun(id: string): Promise<ScheduledTaskRun | undefined> {
    return (await options.runStore.load()).find((run) => run.id === id);
  }

  const scheduler: TaskScheduler = {
    initialize() {
      if (initialized) return Promise.resolve();
      return enqueue(async () => {
        if (initialized) return;
        const startupTime = validNow(now());
        await options.runStore.recoverInterrupted(startupTime.toISOString());
        const loaded = await options.taskStore.load();
        tasks = new Map(loaded.map((task) => [task.id, cloneTask(task)]));
        await options.runStore.deleteOrphanedHistory([...tasks.keys()]);
        const current = startupTime;
        for (const task of [...tasks.values()].sort(compareTasks)) {
          if (!task.enabled) continue;
          const resolution = resolveMissedTask(task, current);
          const next = parseScheduledTask({
            ...task,
            enabled: resolution.disable ? false : task.enabled,
            ...(resolution.nextRunAt ? { nextRunAt: resolution.nextRunAt } : { nextRunAt: undefined }),
            updatedAt: task.updatedAt,
          });
          tasks.set(task.id, next);
          if (resolution.due) await queueRun(next, "catch-up", task.nextRunAt ?? current.toISOString(), "scheduled");
        }
        await persist();
        initialized = true;
        armWakeup();
      });
    },
    snapshot,
    create(input) {
      return enqueue(async () => {
        const parsed = parseScheduledTaskInput(input);
        const timestamp = validNow(now()).toISOString();
        const id = idFactory();
        if (tasks.has(id)) throw new Error("SCHEDULE_TASK_EXISTS");
        const task = parseScheduledTask({
          id, ...parsed, createdAt: timestamp, updatedAt: timestamp,
          ...(parsed.enabled ? { nextRunAt: initialNextRun({ ...parsed, createdAt: timestamp }) } : {}),
        });
        tasks.set(id, task);
        try { await persist(); } catch (error) { tasks.delete(id); throw error; }
        armWakeup();
        options.onChanged?.();
        return cloneTask(task);
      });
    },
    update(id, patch) {
      return enqueue(async () => {
        const current = tasks.get(id);
        if (!current) throw new Error("SCHEDULE_TASK_NOT_FOUND");
        const input = parseScheduledTaskInput({
          name: patch.name ?? current.name,
          prompt: patch.prompt ?? current.prompt,
          schedule: patch.schedule ?? current.schedule,
          timezone: patch.timezone ?? current.timezone,
          missedRunPolicy: patch.missedRunPolicy ?? current.missedRunPolicy,
          enabled: patch.enabled ?? current.enabled,
        });
        const timestamp = validNow(now()).toISOString();
        const next = parseScheduledTask({
          ...current, ...input, updatedAt: timestamp,
          ...(input.enabled ? { nextRunAt: initialNextRun({ ...input, createdAt: current.createdAt }) } : { nextRunAt: undefined }),
        });
        tasks.set(id, next);
        try { await persist(); } catch (error) { tasks.set(id, current); throw error; }
        armWakeup(); options.onChanged?.();
        return cloneTask(next);
      });
    },
    remove(id) {
      return enqueue(async () => {
        const current = tasks.get(id);
        if (!current) throw new Error("SCHEDULE_TASK_NOT_FOUND");
        tasks.delete(id);
        try { await persist(); } catch (error) { tasks.set(id, current); throw error; }
        await options.runStore.deleteTaskHistory(id);
        armWakeup(); options.onChanged?.();
      });
    },
    setEnabled(id, enabled) {
      const current = tasks.get(id);
      if (!current) return Promise.reject(new Error("SCHEDULE_TASK_NOT_FOUND"));
      return scheduler.update(id, { enabled });
    },
    runNow(id) {
      return enqueue(async () => {
        const task = tasks.get(id);
        if (!task) throw new Error("SCHEDULE_TASK_NOT_FOUND");
        if (!task.enabled) throw new Error("SCHEDULE_TASK_DISABLED");
        const timestamp = validNow(now()).toISOString();
        return queueRun(task, "manual", timestamp, "interactive");
      });
    },
    async listRuns(taskId) {
      const runs = await options.runStore.load();
      return runs.filter((run) => !taskId || run.taskId === taskId).sort((a, b) =>
        Date.parse(b.startedAt ?? b.scheduledFor) - Date.parse(a.startedAt ?? a.scheduledFor));
    },
    getRun,
    clearHistory(taskId) {
      return enqueue(async () => {
        if (!tasks.has(taskId)) throw new Error("SCHEDULE_TASK_NOT_FOUND");
        const cleared = await options.runStore.clearTaskHistory(taskId);
        options.onChanged?.();
        return cleared;
      });
    },
    async flush() {
      await operation.catch(() => undefined);
      await options.queue.flush();
    },
    async beginShutdown() {
      if (shuttingDown) return options.queue.flush();
      shuttingDown = true;
      clearWakeup();
      await operation.catch(() => undefined);
      await options.queue.beginShutdown();
    },
    pendingCount() {
      return pendingOperations + options.queue.pendingCount();
    },
  };
  return scheduler;
}

function compareTasks(left: ScheduledTask, right: ScheduledTask): number {
  const leftTime = left.nextRunAt ? Date.parse(left.nextRunAt) : Number.POSITIVE_INFINITY;
  const rightTime = right.nextRunAt ? Date.parse(right.nextRunAt) : Number.POSITIVE_INFINITY;
  return leftTime - rightTime || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function cloneTask(task: ScheduledTask): ScheduledTask {
  return { ...task, schedule: { ...task.schedule } };
}

function validNow(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("SCHEDULE_TIME_INVALID");
  return value;
}
