import {
  createEmptyMemoryFileV2,
  initialMemoryWeight,
  isRecallableL2,
  type ConflictLog,
  type L0Field,
  type L1Field,
  type L2Memory,
  type L2MemoryV1,
  type L2MemoryV2,
  type MemoryFile,
  type MemoryFileV1,
  type MemorySourceSnapshot,
} from "../../src/main/memory/memory-types.js";
import type {
  DeleteProfileFieldInput,
  MemoryConflictRow,
  UpdateProfileFieldInput,
} from "../../src/shared/memory-api-types.js";

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
    ["medium", 0.8, false, 0.48],
    ["high", 0.8, false, 0.68],
    ["medium", 0.8, true, 0.75],
    ["high", 0.8, true, 0.75],
  ] as const)("uses confidence in the initial weight for %s confidence=%s summary=%s", (importance, confidence, isSummary, expected) => {
    expect(initialMemoryWeight(importance, confidence, isSummary)).toBe(expected);
  });

  it("clamps initial weights to the supported range", () => {
    expect(initialMemoryWeight("medium", -1)).toBe(0);
    expect(initialMemoryWeight("high", 2)).toBe(1);
  });

  it("keeps the public memory aliases on the v1 shapes", () => {
    expectTypeOf<L2Memory>().toEqualTypeOf<L2MemoryV1>();
    expectTypeOf<MemoryFile>().toEqualTypeOf<MemoryFileV1>();
  });

  it("accepts the exact source snapshot and conflict log shapes", () => {
    const sourceSnapshot = {
      memoryId: "memory-1",
      updatedAt: "2026-01-02T00:00:00.000Z",
    } satisfies MemorySourceSnapshot;
    const conflict = {
      id: "conflict-1",
      sourceMemoryId: "memory-1",
      targetMemoryId: "memory-2",
      createdAt: "2026-01-02T00:00:00.000Z",
      status: "resolved",
      score: 91,
      priority: "high",
      signals: {},
      attempts: 1,
      resolutionType: "direct_conflict",
      resolutionReason: "The newer fact supersedes the older fact.",
      resolutionConfidence: 0.94,
      finishedAt: "2026-01-02T00:01:00.000Z",
    } satisfies ConflictLog;
    const conflictRow = conflict satisfies MemoryConflictRow;

    expect(sourceSnapshot.memoryId).toBe("memory-1");
    expect(conflictRow.targetMemoryId).toBe("memory-2");
  });

  it("rejects copied source content and nested conflict resolution fields", () => {
    expectTypeOf<keyof MemorySourceSnapshot>().toEqualTypeOf<"memoryId" | "updatedAt">();
    expectTypeOf<keyof ConflictLog>().toEqualTypeOf<
      | "id"
      | "sourceMemoryId"
      | "targetMemoryId"
      | "createdAt"
      | "status"
      | "score"
      | "priority"
      | "signals"
      | "attempts"
      | "resolutionType"
      | "resolutionReason"
      | "resolutionConfidence"
      | "finishedAt"
    >();
    expectTypeOf<keyof MemoryConflictRow>().toEqualTypeOf<
      | "id"
      | "sourceMemoryId"
      | "targetMemoryId"
      | "createdAt"
      | "status"
      | "score"
      | "priority"
      | "attempts"
      | "resolutionType"
      | "resolutionReason"
      | "resolutionConfidence"
      | "finishedAt"
    >();
  });

  it("uses the existing profile field unions in shared mutation inputs", () => {
    const l0Field: L0Field = "preferredName";
    const l1Field: L1Field = "currentProject";
    const l0Update: UpdateProfileFieldInput = { layer: "L0", field: l0Field, value: "Alex" };
    const l1Update: UpdateProfileFieldInput = { layer: "L1", field: l1Field, value: "Cyrene" };
    const l0Delete: DeleteProfileFieldInput = { layer: "L0", field: l0Field };
    const l1Delete: DeleteProfileFieldInput = { layer: "L1", field: l1Field };

    expect([l0Update, l1Update, l0Delete, l1Delete]).toHaveLength(4);
  });

  it("rejects profile fields outside the existing unions", () => {
    // @ts-expect-error profile fields are constrained to L0Field/L1Field
    const invalidUpdate: UpdateProfileFieldInput = { layer: "L0", field: "not-a-field", value: "x" };
    // @ts-expect-error profile fields are constrained to L0Field/L1Field
    const invalidDelete: DeleteProfileFieldInput = { layer: "L1", field: "not-a-field" };

    expect(invalidUpdate).toBeDefined();
    expect(invalidDelete).toBeDefined();
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
