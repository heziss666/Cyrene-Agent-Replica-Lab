import { describe, expect, it, vi } from "vitest";
import { MemoryAccessService } from "../../src/main/memory/memory-access-service.js";
import type { MemoryStore } from "../../src/main/memory/memory-store.js";
import {
  createEmptyMemoryFileV2,
  type L2MemoryV2,
  type MemoryFile,
} from "../../src/main/memory/memory-types.js";

const NOW = new Date("2026-07-15T01:02:03.004Z");

function memory(id: string, overrides: Partial<L2MemoryV2> = {}): L2MemoryV2 {
  return {
    id,
    content: `Private content for ${id}`,
    confidence: 0.8,
    importance: "medium",
    evidenceIds: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    lastAccessedAt: "2026-07-01T00:00:00.000Z",
    accessCount: 0,
    weight: 0.35,
    isPinned: false,
    isEnabled: true,
    status: "aging",
    syncStatus: "synced",
    isSummary: false,
    sourceMemoryIds: [],
    sourceSnapshots: [],
    conflictWith: [],
    ...overrides,
  };
}

function createStore(memories: L2MemoryV2[]) {
  let file: MemoryFile = { ...createEmptyMemoryFileV2(), l2: structuredClone(memories) };
  const store: MemoryStore & { updateCalls: number; read(): MemoryFile } = {
    updateCalls: 0,
    load: vi.fn(async () => structuredClone(file)),
    async update(mutator) {
      store.updateCalls += 1;
      const draft = structuredClone(file);
      mutator(draft);
      file = draft;
      return structuredClone(file);
    },
    read: () => structuredClone(file),
  };
  return store;
}

describe("MemoryAccessService", () => {
  it("deduplicates and reinforces all eligible IDs in one transaction", async () => {
    const store = createStore([
      memory("active", { status: "active", weight: 0.8 }),
      memory("aging", { isPinned: true, weight: 0.2 }),
    ]);
    const service = new MemoryAccessService({
      store,
      now: () => NOW,
      idFactory: () => "audit-access-1",
    });

    const result = await service.recordInjected(["aging", "active", "aging"]);

    expect(result).toEqual({ updatedIds: ["aging", "active"] });
    expect(store.updateCalls).toBe(1);
    expect(store.read().l2).toEqual([
      expect.objectContaining({
        id: "active",
        accessCount: 1,
        lastAccessedAt: NOW.toISOString(),
        weight: 0.85,
        status: "active",
      }),
      expect.objectContaining({
        id: "aging",
        accessCount: 1,
        lastAccessedAt: NOW.toISOString(),
        weight: 1,
        status: "active",
      }),
    ]);
  });

  it("ignores unknown and ineligible IDs", async () => {
    const store = createStore([
      memory("valid"),
      memory("disabled", { isEnabled: false }),
      memory("archived", { status: "archived" }),
      memory("merged", { status: "merged" }),
      memory("superseded", { status: "superseded" }),
    ]);
    const service = new MemoryAccessService({
      store,
      now: () => NOW,
      idFactory: () => "audit-access-1",
    });

    const result = await service.recordInjected([
      "missing",
      "disabled",
      "archived",
      "merged",
      "superseded",
      "valid",
    ]);

    expect(result).toEqual({ updatedIds: ["valid"] });
    expect(store.read().l2.find((item) => item.id === "valid")?.accessCount).toBe(1);
    expect(store.read().l2.filter((item) => item.id !== "valid").every(
      (item) => item.accessCount === 0,
    )).toBe(true);
  });

  it("appends one deterministic metadata-only audit record", async () => {
    const recalled = memory("private-id");
    const store = createStore([recalled]);
    const service = new MemoryAccessService({
      store,
      now: () => NOW,
      idFactory: () => "audit-access-1",
    });

    await service.recordInjected([recalled.id]);

    expect(store.read().auditLogs).toEqual([{
      id: "audit-access-1",
      createdAt: NOW.toISOString(),
      operation: "reinforce_memory_access",
      targetType: "L2",
      source: "automatic",
      result: "success",
      code: "updated_1",
    }]);
    expect(JSON.stringify(store.read().auditLogs)).not.toContain(recalled.content);
  });
});
