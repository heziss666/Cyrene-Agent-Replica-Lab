import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSchedulerRuntime } from "../src/main/scheduler/create-scheduler-runtime.js";

const dataDir = await mkdtemp(join(tmpdir(), "cyrene-scheduler-smoke-"));
try {
  const scheduler = createSchedulerRuntime({
    dataDir,
    runner: { run: async ({ executionMode }) => ({ status: "succeeded", reply: `mode=${executionMode}`, toolCalls: [] }) },
  });
  await scheduler.initialize();
  const task = await scheduler.create({
    name: "Smoke task", prompt: "Verify scheduler", schedule: { kind: "interval", every: 5, unit: "minutes" },
    timezone: "UTC", missedRunPolicy: "run-once", enabled: true,
  });
  const runId = await scheduler.runNow(task.id);
  await scheduler.flush();
  const run = await scheduler.getRun(runId);
  if (run?.status !== "succeeded" || run.reply !== "mode=interactive") throw new Error("Scheduler smoke failed");
  process.stdout.write(`${JSON.stringify({ taskId: task.id, runId, status: run.status, reply: run.reply }, null, 2)}\n`);
  await scheduler.beginShutdown();
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
