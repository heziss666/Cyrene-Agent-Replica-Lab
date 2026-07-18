import { describe, expect, it } from "vitest";
import {
  nextOccurrence,
  resolveMissedTask,
  validateSchedule,
} from "../../src/main/scheduler/schedule-calculator.js";
import type { ScheduledTask } from "../../src/main/scheduler/scheduled-task-types.js";

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "daily",
    name: "Daily",
    prompt: "Run report",
    schedule: { kind: "cron", expression: "0 9 * * *" },
    timezone: "Asia/Shanghai",
    missedRunPolicy: "run-once",
    enabled: true,
    nextRunAt: "2026-07-18T01:00:00.000Z",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("schedule calculator", () => {
  it("calculates once, interval, and timezone-aware cron occurrences", () => {
    expect(nextOccurrence(
      { kind: "once", runAt: "2026-07-20T01:00:00.000Z" },
      "Asia/Shanghai",
      new Date("2026-07-18T00:00:00.000Z"),
    )?.toISOString()).toBe("2026-07-20T01:00:00.000Z");
    expect(nextOccurrence(
      { kind: "interval", every: 6, unit: "hours" },
      "Asia/Shanghai",
      new Date("2026-07-18T00:00:00.000Z"),
    )?.toISOString()).toBe("2026-07-18T06:00:00.000Z");
    expect(nextOccurrence(
      { kind: "cron", expression: "0 9 * * *" },
      "Asia/Shanghai",
      new Date("2026-07-18T02:00:00.000Z"),
    )?.toISOString()).toBe("2026-07-19T01:00:00.000Z");
  });

  it("lets cron-parser handle daylight-saving transitions", () => {
    expect(nextOccurrence(
      { kind: "cron", expression: "0 9 * * *" },
      "America/New_York",
      new Date("2026-03-07T15:00:00.000Z"),
    )?.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });

  it("validates full cron syntax and five fields", () => {
    expect(() => validateSchedule({ kind: "cron", expression: "0 9 * * *" }, "UTC"))
      .not.toThrow();
    expect(() => validateSchedule({ kind: "cron", expression: "90 9 * * *" }, "UTC"))
      .toThrow("SCHEDULE_TIME_INVALID");
    expect(() => validateSchedule({ kind: "cron", expression: "0 0 9 * * *" }, "UTC"))
      .toThrow("SCHEDULE_TIME_INVALID");
  });

  it("runs at most one catch-up and advances to the next future occurrence", () => {
    expect(resolveMissedTask(task(), new Date("2026-07-18T03:00:00.000Z"))).toEqual({
      due: true,
      nextRunAt: "2026-07-19T01:00:00.000Z",
      disable: false,
    });
    expect(resolveMissedTask(task({ missedRunPolicy: "skip" }), new Date("2026-07-18T03:00:00.000Z"))).toEqual({
      due: false,
      nextRunAt: "2026-07-19T01:00:00.000Z",
      disable: false,
    });
  });

  it("disables a missed one-shot after catch-up or skip", () => {
    const once = task({
      schedule: { kind: "once", runAt: "2026-07-18T01:00:00.000Z" },
      nextRunAt: "2026-07-18T01:00:00.000Z",
    });
    expect(resolveMissedTask(once, new Date("2026-07-18T03:00:00.000Z"))).toEqual({
      due: true, disable: true,
    });
    expect(resolveMissedTask({ ...once, missedRunPolicy: "skip" }, new Date("2026-07-18T03:00:00.000Z"))).toEqual({
      due: false, disable: true,
    });
  });
});
