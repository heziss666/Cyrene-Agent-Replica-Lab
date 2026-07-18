import { describe, expect, it, vi } from "vitest";
import { createTaskScheduler } from "../../src/main/scheduler/task-scheduler.js";
import { createScheduledTaskQueue } from "../../src/main/scheduler/scheduled-task-queue.js";
import type { ScheduledTask, ScheduledTaskRun } from "../../src/main/scheduler/scheduled-task-types.js";

function fixture(input: { tasks?: ScheduledTask[]; runnerGate?: Promise<void> } = {}) {
  let tasks = [...(input.tasks ?? [])];
  let runs: ScheduledTaskRun[] = [];
  const timers: Array<{ callback: () => void; delay: number }> = [];
  let now = new Date("2026-07-18T00:00:00.000Z");
  const run = vi.fn(async ({ executionMode }: { executionMode?: string }) => {
    await input.runnerGate;
    return { status: "succeeded" as const, reply: executionMode ?? "none", toolCalls: [] };
  });
  const scheduler = createTaskScheduler({
    taskStore: { load: async () => [...tasks], save: async (next) => { tasks = [...next]; } },
    runStore: {
      load: async () => [...runs],
      append: async (item) => { runs.push(item); },
      update: async (id, updater) => { runs = runs.map((item) => item.id === id ? updater(item) : item); },
      clearTaskHistory: async (taskId) => {
        const before = runs.length;
        runs = runs.filter((item) => item.taskId !== taskId || item.status === "queued" || item.status === "running");
        return before - runs.length;
      },
    },
    queue: createScheduledTaskQueue(),
    runner: { run },
    now: () => now,
    idFactory: (() => { let id = 0; return () => `id-${++id}`; })(),
    setTimer: (callback, delay) => { const handle = { callback, delay }; timers.push(handle); return handle; },
    clearTimer: () => undefined,
  });
  return { scheduler, run, timers, tasks: () => tasks, runs: () => runs, setNow: (value: string) => { now = new Date(value); } };
}

describe("task scheduler", () => {
  it("creates tasks, calculates nextRunAt, and arms one nearest timer", async () => {
    const f = fixture();
    await f.scheduler.initialize();
    const created = await f.scheduler.create({
      name: "Daily", prompt: "Report", schedule: { kind: "cron", expression: "0 9 * * *" },
      timezone: "Asia/Shanghai", missedRunPolicy: "run-once", enabled: true,
    });
    expect(created.nextRunAt).toBe("2026-07-18T01:00:00.000Z");
    expect(f.timers.at(-1)?.delay).toBe(3_600_000);
    expect(f.tasks()).toHaveLength(1);
  });

  it("Run Now uses interactive mode and stores the final result", async () => {
    const f = fixture();
    await f.scheduler.initialize();
    const task = await f.scheduler.create({
      name: "Manual", prompt: "Run", schedule: { kind: "interval", every: 1, unit: "hours" },
      timezone: "Asia/Shanghai", missedRunPolicy: "run-once", enabled: true,
    });
    const runId = await f.scheduler.runNow(task.id);
    await f.scheduler.flush();
    expect(f.run).toHaveBeenCalledWith(expect.objectContaining({ executionMode: "interactive" }));
    expect(f.runs().find((item) => item.id === runId)).toMatchObject({ status: "succeeded", reply: "interactive" });
  });

  it("performs only one catch-up on initialize and advances nextRunAt", async () => {
    const existing: ScheduledTask = {
      id: "daily", name: "Daily", prompt: "Run", schedule: { kind: "cron", expression: "0 9 * * *" },
      timezone: "Asia/Shanghai", missedRunPolicy: "run-once", enabled: true,
      nextRunAt: "2026-07-17T01:00:00.000Z", createdAt: "2026-07-16T00:00:00.000Z", updatedAt: "2026-07-16T00:00:00.000Z",
    };
    const f = fixture({ tasks: [existing] });
    await f.scheduler.initialize();
    await f.scheduler.flush();
    expect(f.run).toHaveBeenCalledOnce();
    expect(f.runs()[0]?.trigger).toBe("catch-up");
    expect(f.tasks()[0]?.nextRunAt).toBe("2026-07-18T01:00:00.000Z");
  });

  it("records overlap rather than running the same task twice", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const f = fixture({ runnerGate: gate });
    await f.scheduler.initialize();
    const task = await f.scheduler.create({
      name: "Manual", prompt: "Run", schedule: { kind: "interval", every: 1, unit: "hours" },
      timezone: "UTC", missedRunPolicy: "run-once", enabled: true,
    });
    await f.scheduler.runNow(task.id);
    const second = await f.scheduler.runNow(task.id);
    expect(f.runs().find((item) => item.id === second)?.status).toBe("skipped_overlap");
    release();
    await f.scheduler.flush();
  });
});
