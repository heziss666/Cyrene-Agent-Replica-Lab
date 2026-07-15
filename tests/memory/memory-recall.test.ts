import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createMemoryRecallService,
} from "../../src/main/memory/memory-recall.js";
import type { MemoryStore } from "../../src/main/memory/memory-store.js";
import type {
  L2Memory,
  MemoryFile,
} from "../../src/main/memory/memory-types.js";
import { RecentMemoryTracker } from "../../src/main/memory/recent-memory-tracker.js";
import type { EmbeddingProvider } from "../../src/main/rag/embedding-provider.js";
import { createInMemoryVectorIndex } from "../../src/main/rag/in-memory-vector-index.js";
import {
  createKnowledgeBase,
  type KnowledgeBase,
} from "../../src/main/rag/knowledge-base.js";
import type {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeSearchResponse,
} from "../../src/main/rag/rag-types.js";
import { hashText } from "../../src/main/rag/text-hash.js";
import {
  createVectorRetriever,
  type VectorRetriever,
} from "../../src/main/rag/vector-retriever.js";

function createMemory(id: string, content = `Content for ${id}`): L2Memory {
  const timestamp = "2026-07-14T00:00:00.000Z";
  return {
    id,
    content,
    confidence: 0.9,
    importance: "high",
    evidenceIds: [`evidence-${id}`],
    createdAt: timestamp,
    updatedAt: timestamp,
    lastAccessedAt: timestamp,
    accessCount: 0,
    weight: 0.765,
    isPinned: false,
    isEnabled: true,
    status: "active",
    syncStatus: "pending_sync",
    isSummary: false,
    sourceMemoryIds: [],
    sourceSnapshots: [],
    conflictWith: [],
  };
}

function createMemoryFile(l2: L2Memory[] = []): MemoryFile {
  return {
    schemaVersion: 2,
    l0: {
      preferredName: "Trailblazer",
      longTermInterests: ["agents"],
      permanentNotes: [],
      fieldMetadata: {},
    },
    l1: {
      currentProject: "Cyrene",
      recentGoals: ["ship recall"],
      recentPreferences: [],
      fieldMetadata: {},
    },
    l2,
    evidence: [],
    conflictLogs: [],
    reflectionLogs: [],
    auditLogs: [],
    maintenance: { successfulWritesSinceMaintenance: 0, running: false },
  };
}

function createStore(file: MemoryFile): MemoryStore {
  return {
    load: vi.fn(async () => structuredClone(file)),
    update: vi.fn(async () => structuredClone(file)),
  };
}

function createRetriever(
  retrieve: VectorRetriever["retrieve"] = async () => [],
): VectorRetriever {
  return {
    model: "fake-model",
    retrieve: vi.fn(retrieve),
    clear: vi.fn(async () => undefined),
  };
}

function createChunk(memory: L2Memory, index = 0): KnowledgeChunk {
  return {
    id: `${memory.id}_chunk_${index}`,
    documentId: memory.id,
    title: memory.id,
    text: memory.content,
    source: "memory",
    index,
  };
}

function createFakeKnowledgeBase(
  response: KnowledgeSearchResponse,
): KnowledgeBase {
  return {
    addDocument: vi.fn(() => []),
    search: vi.fn(async () => response),
    clear: vi.fn(async () => undefined),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("createMemoryRecallService", () => {
  it("returns defensive L0 and L1 copies when the store shares objects", async () => {
    const source = createMemoryFile();
    const store: MemoryStore = {
      load: vi.fn(async () => source),
      update: vi.fn(async () => source),
    };
    const service = createMemoryRecallService({
      store,
      vectorRetriever: createRetriever(),
    });

    const first = await service.recall("query");
    first.l0.longTermInterests.push("mutated");
    first.l1.recentGoals.push("mutated");
    const second = await service.recall("query");

    expect(source.l0.longTermInterests).toEqual(["agents"]);
    expect(source.l1.recentGoals).toEqual(["ship recall"]);
    expect(second.l0.longTermInterests).toEqual(["agents"]);
    expect(second.l1.recentGoals).toEqual(["ship recall"]);
    expect(first.l0).not.toBe(source.l0);
    expect(first.l1).not.toBe(source.l1);
    expect(second.l0).not.toBe(first.l0);
    expect(second.l1).not.toBe(first.l1);
  });

  it("returns L0 and L1 without invoking retrieval when L2 is empty", async () => {
    const file = createMemoryFile();
    const retriever = createRetriever();
    const service = createMemoryRecallService({
      store: createStore(file),
      vectorRetriever: retriever,
    });

    const result = await service.recall("query");

    expect(result).toEqual({ l0: file.l0, l1: file.l1, l2: [] });
    expect(retriever.retrieve).not.toHaveBeenCalled();
  });

  it("prunes the memory index directly when authoritative L2 becomes empty", async () => {
    const memory = createMemory("memory-1");
    const files = [createMemoryFile([memory]), createMemoryFile()];
    const store: MemoryStore = {
      load: vi.fn(async () => structuredClone(files.shift()!)),
      update: vi.fn(async () => createMemoryFile()),
    };
    const embeddingProvider: EmbeddingProvider = {
      id: "fake-provider",
      model: "fake-model",
      embedDocuments: vi.fn(async () => [[1, 0]]),
      embedQuery: vi.fn(async () => [1, 0]),
    };
    const vectorIndex = createInMemoryVectorIndex();
    const initialize = vi.spyOn(vectorIndex, "initialize");
    const prune = vi.spyOn(vectorIndex, "prune");
    const vectorRetriever = createVectorRetriever(embeddingProvider, vectorIndex);
    const retrieve = vi.spyOn(vectorRetriever, "retrieve");
    const knowledgeBases: KnowledgeBase[] = [];
    const createKnowledgeBaseFactory = vi.fn(
      (...args: Parameters<typeof createKnowledgeBase>) => {
        const knowledgeBase = createKnowledgeBase(...args);
        vi.spyOn(knowledgeBase, "search");
        knowledgeBases.push(knowledgeBase);
        return knowledgeBase;
      },
    );
    const service = createMemoryRecallService({
      store,
      embeddingProvider,
      vectorIndex,
      vectorRetriever,
      createKnowledgeBase: createKnowledgeBaseFactory,
    });

    await service.recall("query");
    expect(vectorIndex.has("memory-1_chunk_0", hashText(memory.content))).toBe(true);

    vi.mocked(embeddingProvider.embedDocuments).mockClear();
    vi.mocked(embeddingProvider.embedQuery).mockClear();
    initialize.mockClear();
    prune.mockClear();
    retrieve.mockClear();
    createKnowledgeBaseFactory.mockClear();
    vi.mocked(knowledgeBases[0].search).mockClear();

    const result = await service.recall("query");

    expect(result.l2).toEqual([]);
    expect(initialize).toHaveBeenCalledOnce();
    expect(prune).toHaveBeenCalledOnce();
    expect(prune).toHaveBeenCalledWith([]);
    expect(vectorIndex.has("memory-1_chunk_0", hashText(memory.content))).toBe(false);
    expect(embeddingProvider.embedDocuments).not.toHaveBeenCalled();
    expect(embeddingProvider.embedQuery).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
    expect(createKnowledgeBaseFactory).not.toHaveBeenCalled();
    expect(knowledgeBases[0].search).not.toHaveBeenCalled();
  });

  it("serializes populated index writes before a later empty-corpus prune", async () => {
    const memory = createMemory("memory-1");
    const files = [createMemoryFile([memory]), createMemoryFile()];
    const store: MemoryStore = {
      load: vi.fn(async () => structuredClone(files.shift()!)),
      update: vi.fn(async () => createMemoryFile()),
    };
    const embeddingStarted = createDeferred<void>();
    const releaseEmbedding = createDeferred<void>();
    const embeddingProvider: EmbeddingProvider = {
      id: "fake-provider",
      model: "fake-model",
      embedDocuments: vi.fn(async () => {
        embeddingStarted.resolve();
        await releaseEmbedding.promise;
        return [[1, 0]];
      }),
      embedQuery: vi.fn(async () => [1, 0]),
    };
    const vectorIndex = createInMemoryVectorIndex();
    const operations: string[] = [];
    const originalAddMany = vectorIndex.addMany.bind(vectorIndex);
    const originalPrune = vectorIndex.prune.bind(vectorIndex);
    vi.spyOn(vectorIndex, "addMany").mockImplementation(async (entries) => {
      await originalAddMany(entries);
      operations.push("add");
    });
    vi.spyOn(vectorIndex, "prune").mockImplementation(async (entries) => {
      const removed = await originalPrune(entries);
      operations.push(entries.length === 0 ? "prune-empty" : "prune-populated");
      return removed;
    });
    const service = createMemoryRecallService({
      store,
      embeddingProvider,
      vectorIndex,
    });

    const populatedRecall = service.recall("query");
    await embeddingStarted.promise;
    const emptyRecall = service.recall("query");
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseEmbedding.resolve();

    await Promise.all([populatedRecall, emptyRecall]);

    expect(operations).toEqual(["prune-populated", "add", "prune-empty"]);
    expect(vectorIndex.has("memory-1_chunk_0", hashText(memory.content))).toBe(false);
  });

  it.each(["initialize", "prune"] as const)(
    "contains empty-corpus index %s failures without model work",
    async (failurePoint) => {
      const file = createMemoryFile();
      const embeddingProvider: EmbeddingProvider = {
        id: "fake-provider",
        model: "fake-model",
        embedDocuments: vi.fn(async () => []),
        embedQuery: vi.fn(async () => []),
      };
      const vectorIndex = createInMemoryVectorIndex();
      const initialize = vi.spyOn(vectorIndex, "initialize");
      const prune = vi.spyOn(vectorIndex, "prune");
      const failure = new Error(`sensitive ${failurePoint} detail`);
      if (failurePoint === "initialize") {
        initialize.mockRejectedValue(failure);
      } else {
        prune.mockRejectedValue(failure);
      }
      const vectorRetriever = createRetriever();
      const knowledgeBase = createFakeKnowledgeBase({
        mode: "vector",
        results: [],
      });
      const createKnowledgeBaseFactory = vi.fn(() => knowledgeBase);
      const logger = vi.fn();
      const service = createMemoryRecallService({
        store: createStore(file),
        embeddingProvider,
        vectorIndex,
        vectorRetriever,
        createKnowledgeBase: createKnowledgeBaseFactory,
        logger,
      });

      const result = await service.recall("query");

      expect(result).toEqual({
        l0: file.l0,
        l1: file.l1,
        l2: [],
        warning: "Memory index cleanup failed; recall continued without L2 results",
      });
      expect(result.l0).not.toBe(file.l0);
      expect(result.l1).not.toBe(file.l1);
      expect(initialize).toHaveBeenCalledOnce();
      expect(prune).toHaveBeenCalledTimes(failurePoint === "prune" ? 1 : 0);
      expect(embeddingProvider.embedDocuments).not.toHaveBeenCalled();
      expect(embeddingProvider.embedQuery).not.toHaveBeenCalled();
      expect(vectorRetriever.retrieve).not.toHaveBeenCalled();
      expect(createKnowledgeBaseFactory).not.toHaveBeenCalled();
      expect(knowledgeBase.search).not.toHaveBeenCalled();
      expect(logger).toHaveBeenCalledWith(
        `[Memory] Memory index cleanup failed: sensitive ${failurePoint} detail`,
      );
      expect(result.warning).not.toContain("sensitive");
    },
  );

  it("indexes L2 documents with memory IDs and maps chunks back to memories", async () => {
    const memory1 = createMemory("memory-1");
    const memory2 = createMemory("memory-2");
    const retriever = createRetriever(async (_query, chunks) =>
      chunks.map((chunk, index) => ({ chunk, score: 0.9 - index * 0.1 })),
    );
    const createKnowledgeBaseFactory = vi.fn(createKnowledgeBase);
    const service = createMemoryRecallService({
      store: createStore(createMemoryFile([memory1, memory2])),
      vectorRetriever: retriever,
      createKnowledgeBase: createKnowledgeBaseFactory,
    });

    const result = await service.recall("query");

    expect(retriever.retrieve).toHaveBeenCalledWith(
      "query",
      expect.arrayContaining([
        expect.objectContaining({
          id: "memory-1_chunk_0",
          documentId: "memory-1",
          source: "memory",
        }),
        expect.objectContaining({
          id: "memory-2_chunk_0",
          documentId: "memory-2",
          source: "memory",
        }),
      ]),
      5,
    );
    expect(result.l2).toEqual([
      expect.objectContaining({ memory: memory1, score: 0.9, semanticScore: 0.9 }),
      expect.objectContaining({ memory: memory2, score: 0.8, semanticScore: 0.8 }),
    ]);
  });

  it("filters non-recallable rows before vector top-K so they cannot crowd active memories", async () => {
    const disabled = { ...createMemory("disabled"), isEnabled: false };
    const superseded = { ...createMemory("superseded"), status: "superseded" as const };
    const unsyncedSummary = {
      ...createMemory("summary"),
      isSummary: true,
      syncStatus: "pending_sync" as const,
    };
    const active = createMemory("active");
    const aging = { ...createMemory("aging"), status: "aging" as const };
    const knowledgeBase = createFakeKnowledgeBase({
      mode: "vector",
      results: [
        { chunk: createChunk(disabled), score: 0.99 },
        { chunk: createChunk(superseded), score: 0.98 },
        { chunk: createChunk(unsyncedSummary), score: 0.97 },
        { chunk: createChunk(active), score: 0.96 },
        { chunk: createChunk(aging), score: 0.95 },
      ],
    });
    const receivedDocuments: KnowledgeDocument[][] = [];
    const createKnowledgeBaseFactory = vi.fn((documents?: KnowledgeDocument[]) => {
      receivedDocuments.push(documents ?? []);
      return knowledgeBase;
    });
    const service = createMemoryRecallService({
      store: createStore(createMemoryFile([
        disabled,
        superseded,
        unsyncedSummary,
        active,
        aging,
      ])),
      vectorRetriever: createRetriever(),
      createKnowledgeBase: createKnowledgeBaseFactory,
    });

    const result = await service.recall("query");

    expect(receivedDocuments[0]?.map((document) => document.id)).toEqual(["active", "aging"]);
    expect(result.l2.map(({ memory }) => memory.id)).toEqual(["active", "aging"]);
  });

  it("requests five results, filters scores below 0.35, and returns at most three", async () => {
    const memories = [1, 2, 3, 4, 5].map((id) => createMemory(`memory-${id}`));
    const scores = [0.91, 0.70, 0.50, 0.34, 0.20];
    const knowledgeBase = createFakeKnowledgeBase({
      mode: "vector",
      model: "fake-model",
      results: memories.map((memory, index) => ({
        chunk: createChunk(memory),
        score: scores[index],
      })),
    });
    const service = createMemoryRecallService({
      store: createStore(createMemoryFile(memories)),
      vectorRetriever: createRetriever(),
      createKnowledgeBase: vi.fn(() => knowledgeBase),
    });

    const result = await service.recall("query");

    expect(knowledgeBase.search).toHaveBeenCalledWith("query", 5);
    expect(result.l2.map(({ score }) => score)).toEqual([0.91, 0.70, 0.50]);
  });

  it("breaks equal-score ties by memory ID regardless of input order", async () => {
    const memory1 = createMemory("memory-1");
    const memory2 = createMemory("memory-2");
    const knowledgeBase = createFakeKnowledgeBase({
      mode: "vector",
      results: [
        { chunk: createChunk(memory2), score: 0.8 },
        { chunk: createChunk(memory1), score: 0.8 },
      ],
    });
    const service = createMemoryRecallService({
      store: createStore(createMemoryFile([memory2, memory1])),
      vectorRetriever: createRetriever(),
      createKnowledgeBase: vi.fn(() => knowledgeBase),
    });

    const result = await service.recall("query");

    expect(result.l2.map(({ memory }) => memory.id)).toEqual([
      "memory-1",
      "memory-2",
    ]);
  });

  it("propagates keyword fallback metadata while mapping known memory IDs", async () => {
    const memory1 = createMemory("memory-1");
    const knowledgeBase = createFakeKnowledgeBase({
      mode: "keyword-fallback",
      warning: "Ollama offline",
      results: [{ chunk: createChunk(memory1), score: 0.8 }],
    });
    const service = createMemoryRecallService({
      store: createStore(createMemoryFile([memory1])),
      vectorRetriever: createRetriever(),
      createKnowledgeBase: vi.fn(() => knowledgeBase),
    });

    const result = await service.recall("query");

    expect(result).toMatchObject({
      retrievalMode: "keyword-fallback",
      warning: "Ollama offline",
      l2: [{ memory: memory1, score: 0.8 }],
    });
  });

  it("derives a dedicated persistent index path from the RAG data directory", () => {
    const tempDir = join("C:", "temp", "cyrene-recall");
    const createVectorIndex = vi.fn(() => createInMemoryVectorIndex());
    const embeddingProvider: EmbeddingProvider = {
      id: "fake-provider",
      model: "fake-model",
      embedDocuments: vi.fn(async () => []),
      embedQuery: vi.fn(async () => []),
    };

    createMemoryRecallService({
      store: createStore(createMemoryFile()),
      embeddingProvider,
      createVectorIndex,
      storageConfig: {
        dataDir: tempDir,
        vectorIndexPath: join(tempDir, "vector-index.json"),
      },
    });

    expect(createVectorIndex).toHaveBeenCalledWith(expect.objectContaining({
      filePath: join(tempDir, "memory-vector-index.json"),
    }));
    expect(createVectorIndex).not.toHaveBeenCalledWith(expect.objectContaining({
      filePath: join(tempDir, "vector-index.json"),
    }));
  });

  it("discards unknown IDs and keeps the highest score for each memory", async () => {
    const memory1 = createMemory("memory-1");
    const unknown = createMemory("unknown");
    const knowledgeBase = createFakeKnowledgeBase({
      mode: "vector",
      results: [
        { chunk: createChunk(memory1, 1), score: 0.6 },
        { chunk: createChunk(unknown), score: 0.99 },
        { chunk: createChunk(memory1), score: 0.8 },
      ],
    });
    const service = createMemoryRecallService({
      store: createStore(createMemoryFile([memory1])),
      vectorRetriever: createRetriever(),
      createKnowledgeBase: vi.fn(() => knowledgeBase),
    });

    const result = await service.recall("query");

    expect(result.l2).toEqual([
      expect.objectContaining({ memory: memory1, score: 0.8, semanticScore: 0.8 }),
    ]);
  });

  it("ranks eligible rows with bounded modifiers while enforcing the raw threshold and top three", async () => {
    const weighted = { ...createMemory("weighted"), weight: 1 };
    const pinned = { ...createMemory("pinned"), weight: 1, isPinned: true };
    const recent = { ...createMemory("recent"), weight: 1 };
    const fourth = { ...createMemory("fourth"), weight: 0 };
    const boostedBelowThreshold = { ...createMemory("below-threshold"), weight: 1, isPinned: true };
    const archived = { ...createMemory("archived"), status: "archived" as const };
    const merged = { ...createMemory("merged"), status: "merged" as const };
    const tracker = new RecentMemoryTracker();
    tracker.recordInjected("turn-1", [recent.id]);
    tracker.recordInjected("turn-2", [recent.id]);
    const knowledgeBase = createFakeKnowledgeBase({
      mode: "vector",
      results: [
        { chunk: createChunk(archived), score: 0.99 },
        { chunk: createChunk(merged), score: 0.98 },
        { chunk: createChunk(recent), score: 0.79 },
        { chunk: createChunk(weighted), score: 0.70 },
        { chunk: createChunk(pinned), score: 0.65 },
        { chunk: createChunk(fourth), score: 0.60 },
        { chunk: createChunk(boostedBelowThreshold), score: 0.34 },
      ],
    });
    const service = createMemoryRecallService({
      store: createStore(createMemoryFile([
        weighted, pinned, recent, fourth, boostedBelowThreshold, archived, merged,
      ])),
      vectorRetriever: createRetriever(),
      createKnowledgeBase: vi.fn(() => knowledgeBase),
      recentMemoryTracker: tracker,
      minScore: 0,
    });

    const result = await service.recall("query");

    expect(result.l2).toHaveLength(3);
    expect(result.l2.map(({ memory }) => memory.id)).toEqual(["weighted", "pinned", "recent"]);
    expect(result.l2.map(({ score }) => score)).toEqual([0.70, 0.65, 0.79]);
    expect(result.l2.map((row) => (row as typeof row & { semanticScore: number }).semanticScore))
      .toEqual([0.70, 0.65, 0.79]);
    const finalScores = result.l2.map(
      (row) => (row as typeof row & { finalScore: number }).finalScore,
    );
    expect(finalScores[0]).toBeCloseTo(0.78);
    expect(finalScores[1]).toBeCloseTo(0.76);
    expect(finalScores[2]).toBeCloseTo(0.75);
  });

  it("breaks final-score ties by semantic score and then memory ID", async () => {
    const highSemantic = { ...createMemory("z-high-semantic"), weight: 0 };
    const lowSemanticA = { ...createMemory("a-low-semantic"), weight: 1 };
    const lowSemanticB = { ...createMemory("b-low-semantic"), weight: 1 };
    const knowledgeBase = createFakeKnowledgeBase({
      mode: "vector",
      results: [
        { chunk: createChunk(lowSemanticB), score: 0.60 },
        { chunk: createChunk(highSemantic), score: 0.68 },
        { chunk: createChunk(lowSemanticA), score: 0.60 },
      ],
    });
    const service = createMemoryRecallService({
      store: createStore(createMemoryFile([lowSemanticB, highSemantic, lowSemanticA])),
      vectorRetriever: createRetriever(),
      createKnowledgeBase: vi.fn(() => knowledgeBase),
    });

    const result = await service.recall("query");

    expect(result.l2.map(({ memory }) => memory.id)).toEqual([
      "z-high-semantic", "a-low-semantic", "b-low-semantic",
    ]);
  });
});
