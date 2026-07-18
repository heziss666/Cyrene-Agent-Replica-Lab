import { describe, expect, it } from "vitest";
import { formatSchedule, formatRunStatus } from "../../src/renderer/chat/scheduler-view-model.js";

describe("scheduler view model", () => {
  it("formats all schedule kinds", () => {
    expect(formatSchedule({ kind: "once", runAt: "2026-07-20T01:00:00.000Z" })).toContain("2026");
    expect(formatSchedule({ kind: "interval", every: 2, unit: "hours" })).toBe("Every 2 hours");
    expect(formatSchedule({ kind: "cron", expression: "0 9 * * 1-5" })).toBe("Cron: 0 9 * * 1-5");
  });

  it("makes attention and failed runs visible", () => {
    expect(formatRunStatus("needs_attention")).toBe("Needs attention");
    expect(formatRunStatus("failed")).toBe("Failed");
  });
});
