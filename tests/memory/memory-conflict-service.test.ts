import { describe, expect, it, vi } from "vitest";
import {
  createMemoryConflictService,
} from "../../src/main/memory/memory-conflict-service.js";
import type { MemoryStore } from "../../src/main/memory/memory-store.js";
import {
  createEmptyMemoryFileV2,
  type L2MemoryV2,
  type MemoryFile,
} from "../../src/main/memory/memory-types.js";

const TIME = "2026-07-15T00:00:00.000Z";

function memory(id: string, content: string, overrides: Partial<L2MemoryV2> = {}): L2MemoryV2 {
  return {
    id,
    content,
    confidence: 0.9,
    importance: "medium",
    evidenceIds: [`evidence-${id}`],
    createdAt: TIME,
    updatedAt: TIME,
    lastAccessedAt: TIME,
    accessCount: 0,
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

function file(memories: L2MemoryV2[]): MemoryFile {
  return {
    ...createEmptyMemoryFileV2(),
    l2: structuredClone(memories),
    evidence: memories.flatMap((item) => item.evidenceIds.map((id) => ({
      id,
      memoryId: item.id,
      quote: item.content,
      capturedAt: TIME,
      source: "conversation" as const,
      sourceMemoryIds: [],
    }))),
  };
}

function createStore(initial: MemoryFile): MemoryStore & { read(): MemoryFile; updateCalls: number } {
  let current = structuredClone(initial);
  const store: MemoryStore & { read(): MemoryFile; updateCalls: number } = {
    updateCalls: 0,
    load: vi.fn(async () => structuredClone(current)),
    async update(mutator) {
      store.updateCalls += 1;
      const draft = structuredClone(current);
      mutator(draft);
      current = draft;
      return structuredClone(current);
    },
    read: () => structuredClone(current),
  };
  return store;
}

describe("MemoryConflictService", () => {
  it("deduplicates at most five vector neighbors with recent IDs and commits one symmetric log transaction", async () => {
    const source = memory("new", "I no longer use Python");
    const target = memory("old", "I use Python", { isPinned: true });
    const ignored = memory("ignored", "I use Java");
    const store = createStore(file([source, target, ignored]));
    const vectorNeighbors = vi.fn(async () => [
      { memoryId: "old", similarity: 0.9 },
      { memoryId: "old", similarity: 0.8 },
      { memoryId: "ignored", similarity: 0.9 },
      { memoryId: "missing", similarity: 0.9 },
      { memoryId: "new", similarity: 0.9 },
      { memoryId: "outside-limit", similarity: 1 },
    ]);
    const service = createMemoryConflictService({
      store,
      vectorNeighbors,
      recentInjectionIds: () => ["old", "old", "new"],
      now: () => new Date(TIME),
      idFactory: () => "conflict-1",
    });

    await service.inspectNewMemory(source.id);

    expect(vectorNeighbors).toHaveBeenCalledWith(source, 5);
    expect(store.updateCalls).toBe(1);
    expect(store.read().l2.find((item) => item.id === "new")?.conflictWith).toEqual(["old"]);
    expect(store.read().l2.find((item) => item.id === "old")?.conflictWith).toEqual(["new"]);
    expect(store.read().conflictLogs).toEqual([expect.objectContaining({
      id: "conflict-1",
      sourceMemoryId: "new",
      targetMemoryId: "old",
      status: "queued",
      priority: "high",
      score: 90,
    })]);
  });

  it("does not create a log when the deterministic score is below 35", async () => {
    const source = memory("new", "I no longer use Python", { evidenceIds: [] });
    const target = memory("old", "I use Python", { evidenceIds: [] });
    const store = createStore(file([source, target]));
    const service = createMemoryConflictService({
      store,
      vectorNeighbors: async () => [{ memoryId: "old", similarity: 0.2 }],
      recentInjectionIds: () => [],
    });

    await service.inspectNewMemory(source.id);

    expect(store.updateCalls).toBe(0);
    expect(store.read().conflictLogs).toEqual([]);
  });
});
