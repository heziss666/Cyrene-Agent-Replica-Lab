import {
  createEmptyMemoryFileV2,
  initialMemoryWeight,
  isRecallableL2,
  type L2MemoryV2,
} from "../../src/main/memory/memory-types.js";

describe("v2 memory types", () => {
  it("creates the exact empty v2 memory file", () => {
    expect(createEmptyMemoryFileV2()).toEqual({
      schemaVersion: 2,
      l0: {
        longTermInterests: [],
        permanentNotes: [],
        fieldMetadata: {},
      },
      l1: {
        recentGoals: [],
        recentPreferences: [],
        fieldMetadata: {},
      },
      l2: [],
      evidence: [],
      conflictLogs: [],
      reflectionLogs: [],
      auditLogs: [],
      maintenance: {
        successfulWritesSinceMaintenance: 0,
        running: false,
      },
    });
  });

  it.each([
    ["medium", false, 0.6],
    ["high", false, 0.85],
    ["medium", true, 0.75],
    ["high", true, 0.85],
  ] as const)("uses the expected initial weight for %s summary=%s", (importance, isSummary, expected) => {
    expect(initialMemoryWeight(importance, isSummary)).toBe(expected);
  });

  it("clamps initial weights to the supported range", () => {
    expect(initialMemoryWeight("medium", false, -1)).toBe(0);
    expect(initialMemoryWeight("high", false, 2)).toBe(1);
  });

  it.each([
    ["active", "synced", false, true],
    ["aging", "synced", false, true],
    ["archived", "synced", false, false],
    ["superseded", "synced", false, false],
    ["merged", "synced", false, false],
    ["active", "pending_sync", false, true],
    ["active", "sync_failed", false, true],
    ["active", "pending_sync", true, false],
    ["active", "synced", true, true],
  ] as const)("recallability matrix: %s/%s summary=%s", (status, syncStatus, isSummary, expected) => {
    const memory = {
      id: "memory-1",
      content: "content",
      confidence: 0.8,
      importance: "medium",
      evidenceIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastAccessedAt: "2026-01-01T00:00:00.000Z",
      accessCount: 0,
      weight: 0.6,
      isPinned: false,
      isEnabled: true,
      status,
      syncStatus,
      isSummary,
      sourceMemoryIds: [],
      sourceSnapshots: [],
      conflictWith: [],
    } satisfies L2MemoryV2;

    expect(isRecallableL2(memory)).toBe(expected);
  });

  it("requires enabled memories", () => {
    const memory = {
      id: "memory-1",
      content: "content",
      confidence: 0.8,
      importance: "medium",
      evidenceIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastAccessedAt: "2026-01-01T00:00:00.000Z",
      accessCount: 0,
      weight: 0.6,
      isPinned: false,
      isEnabled: false,
      status: "active",
      syncStatus: "synced",
      isSummary: false,
      sourceMemoryIds: [],
      sourceSnapshots: [],
      conflictWith: [],
    } satisfies L2MemoryV2;

    expect(isRecallableL2(memory)).toBe(false);
  });
});
