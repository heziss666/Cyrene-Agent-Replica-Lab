import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScheduledTaskStore } from "../../src/main/scheduler/scheduled-task-store.js";
import { createScheduledRunStore } from "../../src/main/scheduler/scheduled-run-store.js";
import type { ScheduledTask, ScheduledTaskRun } from "../../src/main/scheduler/scheduled-task-types.js";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

async function tempFile(name: string): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "cyrene-scheduler-"));
  dirs.push(dir);
  return { dir, file: join(dir, name) };
}

const task: ScheduledTask = {
  id: "daily", name: "Daily", prompt: "Report",
  schedule: { kind: "cron", expression: "0 9 * * *" },
  timezone: "Asia/Shanghai", missedRunPolicy: "run-once", enabled: true,
  nextRunAt: "2026-07-19T01:00:00.000Z",
  createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z",
};

function run(index: number, taskId = "daily"): ScheduledTaskRun {
  const timestamp = new Date(Date.UTC(2026, 6, 18, 0, index)).toISOString();
  return {
    id: `run-${index}`, taskId, trigger: "scheduled", status: "succeeded",
    scheduledFor: timestamp, startedAt: timestamp, finishedAt: timestamp,
    reply: `${index}`, toolCalls: [],
  };
}

describe("scheduled stores", () => {
  it("round-trips versioned task files and returns empty for missing files", async () => {
    const { file } = await tempFile("tasks.json");
    const store = createScheduledTaskStore(file);
    expect(await store.load()).toEqual([]);
    await store.save([task]);
    expect(await store.load()).toEqual([task]);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ schemaVersion: 1, tasks: [task] });
  });

  it("quarantines corrupt task and run files", async () => {
    const taskPath = await tempFile("tasks.json");
    await writeFile(taskPath.file, "{broken", "utf8");
    expect(await createScheduledTaskStore(taskPath.file, { now: () => 123 }).load()).toEqual([]);
    expect(await readdir(taskPath.dir)).toContain("tasks.json.corrupt-123");

    const runPath = await tempFile("runs.json");
    await writeFile(runPath.file, "{broken", "utf8");
    expect(await createScheduledRunStore(runPath.file, { now: () => 456 }).load()).toEqual([]);
    expect(await readdir(runPath.dir)).toContain("runs.json.corrupt-456");
  });

  it("serializes run append/update and keeps at most 100 runs per task", async () => {
    const { file } = await tempFile("runs.json");
    const store = createScheduledRunStore(file);
    await Promise.all(Array.from({ length: 101 }, (_, index) => store.append(run(index))));
    const retained = await store.load();
    expect(retained).toHaveLength(100);
    expect(retained.some((item) => item.id === "run-0")).toBe(false);
    await store.update("run-100", (current) => ({ ...current, reply: "updated" }));
    expect((await store.load()).find((item) => item.id === "run-100")?.reply).toBe("updated");
  });

  it("clears completed history for one task while preserving active and other task runs", async () => {
    const { file } = await tempFile("runs.json");
    const store = createScheduledRunStore(file);
    await store.append(run(1, "daily"));
    await store.append({ ...run(2, "daily"), status: "running", finishedAt: undefined });
    await store.append(run(3, "weekly"));
    expect(await store.clearTaskHistory("daily")).toBe(1);
    expect((await store.load()).map(({ id }) => id)).toEqual(["run-2", "run-3"]);
  });
});
