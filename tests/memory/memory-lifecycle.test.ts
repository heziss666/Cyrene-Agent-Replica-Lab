import { describe, expect, it } from "vitest";
import {
  calculateDecayedMemory,
  reinforceMemory,
} from "../../src/main/memory/memory-lifecycle.js";
import type { L2MemoryV2 } from "../../src/main/memory/memory-types.js";

const NOW = new Date("2026-07-15T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;

function memory(overrides: Partial<L2MemoryV2> = {}): L2MemoryV2 {
  return {
    id: "memory-1",
    content: "Private memory content",
    confidence: 0.8,
    importance: "medium",
    evidenceIds: ["evidence-1"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastAccessedAt: new Date(NOW.getTime() - 10 * DAY_MS).toISOString(),
    accessCount: 2,
    weight: 0.8,
    isPinned: false,
    isEnabled: true,
    status: "active",
    syncStatus: "synced",
    isSummary: false,
    sourceMemoryIds: [],
    sourceSnapshots: [],
    conflictWith: [],
    ...overrides,
  };
}

describe("calculateDecayedMemory", () => {
  it("returns the original object when no time elapsed", () => {
    const original = memory();

    expect(calculateDecayedMemory(original, 0, NOW)).toBe(original);
  });

  it.each([
    ["medium", false, 45],
    ["high", false, 90],
    ["medium", true, 180],
  ] as const)("halves %s memory with summary=%s after %s days", (importance, isSummary, days) => {
    const original = memory({ importance, isSummary });

    const result = calculateDecayedMemory(original, days, NOW);

    expect(result.weight).toBe(0.4);
    expect(result).not.toBe(original);
    expect(original.weight).toBe(0.8);
  });

  it("rounds a persisted decayed weight to six decimal places", () => {
    const result = calculateDecayedMemory(memory({ weight: 0.731234 }), 7, NOW);

    expect(result.weight).toBe(0.656492);
  });

  it("keeps pinned memory active and restores its invariant weight", () => {
    const result = calculateDecayedMemory(
      memory({ isPinned: true, weight: 0.2, status: "active" }),
      365,
      NOW,
    );

    expect(result).toMatchObject({ weight: 1, status: "active" });
  });

  it("moves memory below 0.35 to aging", () => {
    const result = calculateDecayedMemory(memory({ weight: 0.6 }), 45, NOW);

    expect(result).toMatchObject({ weight: 0.3, status: "aging" });
  });

  it("archives memory below 0.15 after at least 30 days without access", () => {
    const result = calculateDecayedMemory(memory({
      weight: 0.2,
      status: "aging",
      lastAccessedAt: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
    }), 45, NOW);

    expect(result).toMatchObject({ weight: 0.1, status: "archived" });
  });

  it("keeps recently accessed low-weight memory aging", () => {
    const result = calculateDecayedMemory(memory({
      weight: 0.2,
      status: "aging",
      lastAccessedAt: new Date(NOW.getTime() - 30 * DAY_MS + 1).toISOString(),
    }), 45, NOW);

    expect(result).toMatchObject({ weight: 0.1, status: "aging" });
  });

  it.each(["archived", "superseded", "merged"] as const)(
    "leaves %s entries unchanged",
    (status) => {
      const original = memory({ status, weight: 0.2 });

      expect(calculateDecayedMemory(original, 365, NOW)).toBe(original);
    },
  );

  it("decays disabled memory", () => {
    const result = calculateDecayedMemory(memory({ isEnabled: false }), 45, NOW);

    expect(result.weight).toBe(0.4);
  });
});

describe("reinforceMemory", () => {
  it("increments access metadata and weight without mutating the input", () => {
    const original = memory({ weight: 0.6 });

    const result = reinforceMemory(original, NOW);

    expect(result).toMatchObject({
      accessCount: 3,
      lastAccessedAt: NOW.toISOString(),
      weight: 0.65,
      status: "active",
    });
    expect(result).not.toBe(original);
    expect(original).toMatchObject({ accessCount: 2, weight: 0.6 });
  });

  it("reactivates aging memory at the 0.40 reinforcement threshold", () => {
    expect(reinforceMemory(memory({ status: "aging", weight: 0.35 }), NOW)).toMatchObject({
      weight: 0.4,
      status: "active",
    });
  });

  it("keeps aging memory below the reactivation threshold", () => {
    expect(reinforceMemory(memory({ status: "aging", weight: 0.34 }), NOW)).toMatchObject({
      weight: 0.39,
      status: "aging",
    });
  });

  it("caps ordinary weight and keeps pinned weight at one", () => {
    expect(reinforceMemory(memory({ weight: 0.98 }), NOW).weight).toBe(1);
    expect(reinforceMemory(memory({ isPinned: true, weight: 0.7 }), NOW).weight).toBe(1);
  });
});
