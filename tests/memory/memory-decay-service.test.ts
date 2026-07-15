import { describe, expect, it, vi } from "vitest";
import { MemoryDecayService } from "../../src/main/memory/memory-decay-service.js";
import type { MemoryStore } from "../../src/main/memory/memory-store.js";
import {
  createEmptyMemoryFileV2,
  type L2MemoryV2,
  type MemoryFile,
} from "../../src/main/memory/memory-types.js";

const NOW = new Date("2026-07-15T00:00:00.000Z");
const LAST_DECAY = new Date("2026-05-31T00:00:00.000Z");

function memory(id: string, overrides: Partial<L2MemoryV2> = {}): L2MemoryV2 {
  return {
    id,
    content: `Private content for ${id}`,
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
    status: "active",
    syncStatus: "synced",
    isSummary: false,
    sourceMemoryIds: [],
    sourceSnapshots: [],
    conflictWith: [],
    ...overrides,
  };
}

function createStore(initial: MemoryFile) {
  let file = structuredClone(initial);
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

describe("MemoryDecayService", () => {
  it("updates every eligible L2 and one counts-only audit atomically", async () => {
    const initial = createEmptyMemoryFileV2();
    initial.maintenance.lastDecayAt = LAST_DECAY.toISOString();
    initial.l2 = [
      memory("active-to-aging"),
      memory("aging-to-archived", { status: "aging", weight: 0.2 }),
      memory("terminal", { status: "archived", weight: 0.7 }),
    ];
    const store = createStore(initial);
    const service = new MemoryDecayService({
      store,
      idFactory: () => "audit-decay-1",
    });

    const result = await service.runDecay(NOW);

    expect(result).toEqual({
      activeToAging: 1,
      agingToArchived: 1,
      weightUpdated: 2,
    });
    expect(store.updateCalls).toBe(1);
    expect(store.read().maintenance.lastDecayAt).toBe(NOW.toISOString());
    expect(store.read().l2).toEqual([
      expect.objectContaining({ id: "active-to-aging", status: "aging", weight: 0.3 }),
      expect.objectContaining({ id: "aging-to-archived", status: "archived", weight: 0.1 }),
      expect.objectContaining({ id: "terminal", status: "archived", weight: 0.7 }),
    ]);
    expect(store.read().auditLogs).toEqual([{
      id: "audit-decay-1",
      createdAt: NOW.toISOString(),
      operation: "decay_memory",
      targetType: "L2",
      source: "automatic",
      result: "success",
      code: "activeToAging=1;agingToArchived=1;weightUpdated=2",
    }]);
    expect(JSON.stringify(store.read().auditLogs)).not.toContain("Private content");
  });

  it("is idempotent at the same timestamp and skips a later run inside 24 hours", async () => {
    const initial = createEmptyMemoryFileV2();
    initial.maintenance.lastDecayAt = LAST_DECAY.toISOString();
    initial.l2 = [memory("memory-1")];
    const store = createStore(initial);
    const service = new MemoryDecayService({ store, idFactory: () => "audit-decay" });

    await service.runDecay(NOW);
    const afterFirst = store.read();

    await expect(service.runDecay(NOW)).resolves.toEqual({
      activeToAging: 0,
      agingToArchived: 0,
      weightUpdated: 0,
    });
    await expect(service.runDecay(new Date(NOW.getTime() + 24 * 60 * 60 * 1_000 - 1)))
      .resolves.toEqual({
        skipped: true,
        reason: "interval",
      });
    expect(store.read()).toEqual(afterFirst);
  });

  it("allows the exact 24-hour boundary", async () => {
    const initial = createEmptyMemoryFileV2();
    initial.maintenance.lastDecayAt = NOW.toISOString();
    initial.l2 = [memory("memory-1")];
    const store = createStore(initial);
    const service = new MemoryDecayService({ store, idFactory: () => "audit-decay" });
    const boundary = new Date(NOW.getTime() + 24 * 60 * 60 * 1_000);

    const result = await service.runDecay(boundary);

    expect("skipped" in result).toBe(false);
    expect(store.read().maintenance.lastDecayAt).toBe(boundary.toISOString());
  });

  it.each([
    ["invalid now", () => new Date(Number.NaN), LAST_DECAY.toISOString()],
    ["invalid last decay", () => NOW, "not-a-timestamp"],
  ])("rejects %s without modifying the store", async (_label, createNow, lastDecayAt) => {
    const initial = createEmptyMemoryFileV2();
    initial.maintenance.lastDecayAt = lastDecayAt;
    initial.l2 = [memory("memory-1")];
    const store = createStore(initial);
    const service = new MemoryDecayService({ store });

    await expect(service.runDecay(createNow())).rejects.toThrow("Invalid timestamp");
    expect(store.read()).toEqual(initial);
  });

  it("rejects an invalid eligible-memory access timestamp atomically", async () => {
    const initial = createEmptyMemoryFileV2();
    initial.maintenance.lastDecayAt = LAST_DECAY.toISOString();
    initial.l2 = [
      memory("would-change"),
      memory("invalid", { lastAccessedAt: "not-a-timestamp" }),
    ];
    const store = createStore(initial);
    const service = new MemoryDecayService({ store });

    await expect(service.runDecay(NOW)).rejects.toThrow("Invalid timestamp");
    expect(store.read()).toEqual(initial);
  });
});
