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
import type { EmbeddingProvider } from "../../src/main/rag/embedding-provider.js";
import { createInMemoryVectorIndex } from "../../src/main/rag/in-memory-vector-index.js";
import {
  createKnowledgeBase,
  type KnowledgeBase,
} from "../../src/main/rag/knowledge-base.js";
import type {
  KnowledgeChunk,
  KnowledgeSearchResponse,
} from "../../src/main/rag/rag-types.js";
import type { VectorRetriever } from "../../src/main/rag/vector-retriever.js";

function createMemory(id: string, content = `Content for ${id}`): L2Memory {
  return {
    id,
    content,
    confidence: 0.9,
    importance: "high",
    evidence: {
      userQuote: content,
      capturedAt: "2026-07-14T00:00:00.000Z",
    },
    createdAt: "2026-07-14T00:00:00.000Z",
    status: "active",
  };
}

function createMemoryFile(l2: L2Memory[] = []): MemoryFile {
  return {
    schemaVersion: 1,
    l0: {
      preferredName: "Trailblazer",
      longTermInterests: ["agents"],
      permanentNotes: [],
    },
    l1: {
      currentProject: "Cyrene",
      recentGoals: ["ship recall"],
      recentPreferences: [],
    },
    l2,
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

describe("createMemoryRecallService", () => {
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
      { memory: memory1, score: 0.9 },
      { memory: memory2, score: 0.8 },
    ]);
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

    expect(result.l2).toEqual([{ memory: memory1, score: 0.8 }]);
  });
});
