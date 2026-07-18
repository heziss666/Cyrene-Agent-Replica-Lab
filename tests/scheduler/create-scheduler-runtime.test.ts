import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSchedulerRuntime } from "../../src/main/scheduler/create-scheduler-runtime.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("createSchedulerRuntime", () => {
  it("persists tasks and can restore them in a new runtime", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "scheduler-runtime-")); dirs.push(dataDir);
    const runner = { run: vi.fn(async () => ({ status: "succeeded" as const, reply: "ok", toolCalls: [] })) };
    const first = createSchedulerRuntime({ dataDir, runner });
    await first.initialize();
    await first.create({ name: "Daily", prompt: "Review", schedule: { kind: "interval", every: 1, unit: "days" }, timezone: "UTC", missedRunPolicy: "run-once", enabled: true });
    await first.beginShutdown();

    const second = createSchedulerRuntime({ dataDir, runner });
    await second.initialize();
    expect(second.snapshot().tasks).toHaveLength(1);
    expect(second.snapshot().tasks[0]?.name).toBe("Daily");
    await second.beginShutdown();
  });
});
