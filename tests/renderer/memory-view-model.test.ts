import { describe, expect, it } from "vitest";
import type {
  MemoryL2Row,
  MemorySnapshot,
} from "../../src/shared/memory-api-types.js";
import {
  MemoryViewModel,
  filterL2Rows,
  getOverviewCounts,
  mapMutationError,
  validateProfileValue,
} from "../../src/renderer/chat/memory-view-model.js";

function row(overrides: Partial<MemoryL2Row> = {}): MemoryL2Row {
  return {
    id: "memory-1",
    content: "I use TypeScript",
    confidence: 0.9,
    importance: "high",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    lastAccessedAt: "2026-07-02T00:00:00.000Z",
    accessCount: 2,
    weight: 0.8,
    isPinned: false,
    isEnabled: true,
    status: "active",
    syncStatus: "synced",
    isSummary: false,
    evidenceCount: 1,
    sourceMemoryIds: [],
    conflictWith: [],
    ...overrides,
  };
}

function snapshot(overrides: Partial<MemorySnapshot> = {}): MemorySnapshot {
  return {
    l0: { preferredName: "Alex", longTermInterests: [], permanentNotes: [] },
    l1: { currentProject: "Replica", recentGoals: [], recentPreferences: [] },
    l2: [row(), row({ id: "memory-2", content: "I prefer light mode", status: "aging", isPinned: true })],
    conflicts: [],
    reflections: [],
    audit: [],
    maintenance: { successfulWritesSinceMaintenance: 2, running: false },
    ...overrides,
  };
}

describe("memory view model", () => {
  it("filters L2 rows by text, status, enabled state, and pinned state", () => {
    const rows = [
      row({ id: "one", content: "I use TypeScript", status: "active" }),
      row({ id: "two", content: "I prefer light mode", isEnabled: false, status: "archived" }),
      row({ id: "three", content: "I use Python", isPinned: true }),
    ];

    expect(filterL2Rows(rows, { query: "python" }).map((item) => item.id)).toEqual(["three"]);
    expect(filterL2Rows(rows, { status: "archived" }).map((item) => item.id)).toEqual(["two"]);
    expect(filterL2Rows(rows, { enabled: "enabled" }).map((item) => item.id)).toEqual(["one", "three"]);
    expect(filterL2Rows(rows, { pinned: "pinned" }).map((item) => item.id)).toEqual(["three"]);
  });

  it("sorts with stable tie-breaking for every supported sort key", () => {
    const rows = [
      row({ id: "first", updatedAt: "2026-07-01T00:00:00.000Z", weight: 0.4, accessCount: 1, status: "active" }),
      row({ id: "second", updatedAt: "2026-07-03T00:00:00.000Z", weight: 0.9, accessCount: 4, status: "archived" }),
      row({ id: "third", updatedAt: "2026-07-03T00:00:00.000Z", weight: 0.9, accessCount: 4, status: "active" }),
    ];

    expect(filterL2Rows(rows, { sort: "updatedAt" }).map((item) => item.id)).toEqual(["second", "third", "first"]);
    expect(filterL2Rows(rows, { sort: "weight" }).map((item) => item.id)).toEqual(["second", "third", "first"]);
    expect(filterL2Rows(rows, { sort: "accessCount" }).map((item) => item.id)).toEqual(["second", "third", "first"]);
    expect(filterL2Rows(rows, { sort: "status" }).map((item) => item.id)).toEqual(["first", "third", "second"]);
  });

  it("computes overview counts and maps validation errors without exposing raw API text", () => {
    const counts = getOverviewCounts(snapshot());
    expect(counts).toMatchObject({ l0: 3, l1: 3, l2: 2, enabled: 2, pinned: 1, conflicts: 0 });
    expect(validateProfileValue("L0", "preferredName", "   ")).toBe("Enter a value before saving.");
    expect(validateProfileValue("L0", "preferredName", "Alex")).toBeUndefined();
    expect(mapMutationError({ ok: false, code: "invalid_content", message: "secret" })).toBe(
      "This memory could not be saved because the content was rejected.",
    );
    expect(mapMutationError({ ok: false, code: "not_found", message: "gone" })).toBe(
      "This memory changed elsewhere. Refresh and try again.",
    );
  });

  it("replaces its snapshot only after a successful mutation", () => {
    const model = new MemoryViewModel(snapshot());
    const next = snapshot({ l0: { preferredName: "Morgan", longTermInterests: [], permanentNotes: [] } });

    expect(model.applyMutation({ ok: false, code: "invalid_state", message: "busy" })).toEqual({
      ok: false,
      error: "This memory is not available for that action.",
    });
    expect(model.snapshot.l0.preferredName).toBe("Alex");
    expect(model.applyMutation({ ok: true, snapshot: next })).toEqual({ ok: true });
    expect(model.snapshot.l0.preferredName).toBe("Morgan");
  });
});
