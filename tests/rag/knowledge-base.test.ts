import { describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../../src/main/rag/embedding-provider.js";
import { createInMemoryVectorIndex } from "../../src/main/rag/in-memory-vector-index.js";
import { createKnowledgeBase } from "../../src/main/rag/knowledge-base.js";
import { createVectorRetriever } from "../../src/main/rag/vector-retriever.js";

function createFakeProvider(overrides: Partial<EmbeddingProvider> = {}): EmbeddingProvider {
  return {
    id: "fake",
    model: "fake-model",
    embedDocuments: async (texts) =>
      texts.map((_, index) => [index === 0 ? 1 : 0, index === 0 ? 0 : 1]),
    embedQuery: async () => [1, 0],
    ...overrides,
  };
}

describe("createKnowledgeBase", () => {
  it("adds documents and searches their chunks with vectors", async () => {
    const retriever = createVectorRetriever(
      createFakeProvider(),
      createInMemoryVectorIndex(),
    );
    const knowledgeBase = createKnowledgeBase([], undefined, {
      vectorRetriever: retriever,
    });
    knowledgeBase.addDocument({
      title: "Agent Tools",
      text: "The agent can call tools through the ToolRegistry.",
      source: "test",
    });

    const response = await knowledgeBase.search("How are tools registered?", 3);

    expect(response.mode).toBe("vector");
    expect(response.model).toBe("fake-model");
    expect(response.results[0]?.chunk.title).toBe("Agent Tools");
  });

  it("loads initial documents and uses keyword fallback without a vector retriever", async () => {
    const knowledgeBase = createKnowledgeBase([
      {
        id: "initial_doc",
        title: "Initial Knowledge",
        text: "RAG means retrieval augmented generation.",
        source: "seed",
      },
    ]);

    const response = await knowledgeBase.search("retrieval");

    expect(response.mode).toBe("keyword-fallback");
    expect(response.warning).toBe("Vector retriever is not configured");
    expect(response.results).toHaveLength(1);
  });

  it("clears documents and vector state", async () => {
    const clear = vi.fn();
    const vectorRetriever = {
      model: "fake-model",
      retrieve: vi.fn(async () => []),
      clear,
    };
    const knowledgeBase = createKnowledgeBase([], undefined, { vectorRetriever });
    knowledgeBase.addDocument({
      title: "Temporary",
      text: "This should disappear.",
      source: "test",
    });

    knowledgeBase.clear();
    const response = await knowledgeBase.search("disappear");

    expect(clear).toHaveBeenCalledOnce();
    expect(response.results).toEqual([]);
  });

  it("creates stable generated document ids", () => {
    const knowledgeBase = createKnowledgeBase();
    const first = knowledgeBase.addDocument({
      title: "First",
      text: "alpha",
      source: "test",
    });
    const second = knowledgeBase.addDocument({
      title: "Second",
      text: "beta",
      source: "test",
    });

    expect(first[0].documentId).toBe("doc_1");
    expect(second[0].documentId).toBe("doc_2");
  });

  it("falls back to keyword search and preserves the vector error", async () => {
    const provider = createFakeProvider({
      embedDocuments: async () => {
        throw new Error("Ollama is offline");
      },
    });
    const knowledgeBase = createKnowledgeBase([], undefined, {
      vectorRetriever: createVectorRetriever(
        provider,
        createInMemoryVectorIndex(),
      ),
    });
    knowledgeBase.addDocument({
      title: "ToolRegistry",
      text: "ToolRegistry registers tools.",
      source: "test",
    });

    const response = await knowledgeBase.search("ToolRegistry");

    expect(response.mode).toBe("keyword-fallback");
    expect(response.warning).toBe("Ollama is offline");
    expect(response.results).toHaveLength(1);
  });
});
