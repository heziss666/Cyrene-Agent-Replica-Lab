import { describe, expect, it } from "vitest";
import { RecentMemoryTracker } from "../../src/main/memory/recent-memory-tracker.js";

describe("RecentMemoryTracker", () => {
  it("penalizes memories by the number of retained turns that injected them", () => {
    const tracker = new RecentMemoryTracker();

    tracker.recordInjected("turn-1", ["m1", "m2"]);
    tracker.recordInjected("turn-2", ["m1"]);
    tracker.recordInjected("turn-3", ["m3"]);

    expect(tracker.penaltyFor("m1", 0.60)).toBe(0.12);
    expect(tracker.penaltyFor("m2", 0.60)).toBe(0.06);
    expect(tracker.penaltyFor("m3", 0.60)).toBe(0.06);
    expect(tracker.penaltyFor("m1", 0.80)).toBe(0);
  });

  it("deduplicates IDs within a turn and retains only the three newest turns", () => {
    const tracker = new RecentMemoryTracker();

    tracker.recordInjected("turn-1", ["m1", "m1"]);
    tracker.recordInjected("turn-2", ["m2"]);
    tracker.recordInjected("turn-3", ["m3"]);
    tracker.recordInjected("turn-4", ["m1"]);

    expect(tracker.penaltyFor("m1", 0.60)).toBe(0.06);
    expect(tracker.penaltyFor("m2", 0.60)).toBe(0.06);
    expect(tracker.snapshot()).toEqual([
      { turnId: "turn-2", ids: ["m2"] },
      { turnId: "turn-3", ids: ["m3"] },
      { turnId: "turn-4", ids: ["m1"] },
    ]);
  });

  it("caps the penalty and clears all retained turns", () => {
    const tracker = new RecentMemoryTracker();

    tracker.recordInjected("turn-1", ["m1"]);
    tracker.recordInjected("turn-2", ["m1"]);
    tracker.recordInjected("turn-3", ["m1"]);

    expect(tracker.penaltyFor("m1", 0.79)).toBe(0.12);

    tracker.clear();

    expect(tracker.snapshot()).toEqual([]);
    expect(tracker.penaltyFor("m1", 0.79)).toBe(0);
  });
});
