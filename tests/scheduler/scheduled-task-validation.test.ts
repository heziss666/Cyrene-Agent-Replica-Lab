import { describe, expect, it } from "vitest";
import {
  parseScheduledRun,
  parseScheduledRunsFile,
  parseScheduledTask,
  parseScheduledTaskInput,
  parseScheduledTasksFile,
} from "../../src/main/scheduler/scheduled-task-validation.js";

const TASK = {
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
} as const;

describe("scheduled task validation", () => {
  it("parses strict persisted tasks and defaults task inputs", () => {
    expect(parseScheduledTask(TASK)).toEqual(TASK);
    expect(parseScheduledTaskInput({
      name: "Once",
      prompt: "Run one report",
      schedule: { kind: "once", runAt: "2026-07-20T01:00:00.000Z" },
    })).toEqual({
      name: "Once",
      prompt: "Run one report",
      schedule: { kind: "once", runAt: "2026-07-20T01:00:00.000Z" },
      timezone: "Asia/Shanghai",
      missedRunPolicy: "run-once",
      enabled: true,
    });
  });

  it("accepts bounded intervals and five-field cron only", () => {
    expect(() => parseScheduledTaskInput({
      name: "Interval",
      prompt: "Run periodically",
      schedule: { kind: "interval", every: 5, unit: "minutes" },
    })).not.toThrow();
    expect(() => parseScheduledTaskInput({
      name: "Too fast",
      prompt: "Run periodically",
      schedule: { kind: "interval", every: 4, unit: "minutes" },
    })).toThrow("SCHEDULE_CONFIG_INVALID");
    expect(() => parseScheduledTaskInput({
      name: "Seconds cron",
      prompt: "Run periodically",
      schedule: { kind: "cron", expression: "0 0 9 * * *" },
    })).toThrow("SCHEDULE_CONFIG_INVALID");
  });

  it("rejects invalid timezones, unknown keys, and duplicate ids", () => {
    expect(() => parseScheduledTaskInput({
      name: "Bad timezone",
      prompt: "Run",
      schedule: { kind: "cron", expression: "0 9 * * *" },
      timezone: "Mars/Olympus",
    })).toThrow("SCHEDULE_CONFIG_INVALID");
    expect(() => parseScheduledTask({ ...TASK, extra: true })).toThrow("SCHEDULE_CONFIG_INVALID");
    expect(() => parseScheduledTasksFile({ schemaVersion: 1, tasks: [TASK, TASK] }))
      .toThrow("SCHEDULE_CONFIG_INVALID");
  });

  it("parses safe run records and rejects unknown statuses", () => {
    const run = {
      id: "run-1",
      taskId: TASK.id,
      trigger: "scheduled",
      status: "succeeded",
      scheduledFor: "2026-07-19T01:00:00.000Z",
      startedAt: "2026-07-19T01:00:00.000Z",
      finishedAt: "2026-07-19T01:00:01.000Z",
      reply: "Done",
      toolCalls: [{
        toolId: "github__list_issues",
        args: { owner: "heziss666" },
        status: "succeeded",
        startedAt: "2026-07-19T01:00:00.100Z",
        finishedAt: "2026-07-19T01:00:00.900Z",
        outputSummary: "3 issues",
      }],
    };
    expect(parseScheduledRun(run)).toEqual(run);
    expect(parseScheduledRunsFile({ schemaVersion: 1, runs: [run] })).toEqual([run]);
    expect(() => parseScheduledRun({ ...run, status: "mystery" }))
      .toThrow("SCHEDULE_CONFIG_INVALID");
  });

  it("parses a versioned task file", () => {
    expect(parseScheduledTasksFile({ schemaVersion: 1, tasks: [TASK] })).toEqual([TASK]);
  });
});
