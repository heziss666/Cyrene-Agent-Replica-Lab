import { describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../../src/main/rag/embedding-provider.js";
import { createInMemoryVectorIndex } from "../../src/main/rag/in-memory-vector-index.js";
import type { KnowledgeChunk } from "../../src/main/rag/rag-types.js";
import { hashText } from "../../src/main/rag/text-hash.js";
import { createVectorRetriever } from "../../src/main/rag/vector-retriever.js";

function chunk(id: string, text: string): KnowledgeChunk {
  return {
    id,
    documentId: "doc",
    title: id,
    text,
    source: "test",
    index: 0,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("createVectorRetriever", () => {
  it("indexes documents once and ranks by cosine similarity", async () => {
    const embedDocuments = vi.fn(async () => [[1, 0], [0, 1]]);
    const embedQuery = vi.fn(async () => [0.9, 0.1]);
    const provider: EmbeddingProvider = {
      id: "fake",
      model: "fake-model",
      embedDocuments,
      embedQuery,
    };
    const retriever = createVectorRetriever(
      provider,
      createInMemoryVectorIndex(),
    );
    const chunks = [chunk("tools", "tool registry"), chunk("weather", "sunny")];

    const first = await retriever.retrieve("how are tools registered", chunks, 2);
    const second = await retriever.retrieve("tools again", chunks, 1);

    expect(first.map((result) => result.chunk.id)).toEqual(["tools", "weather"]);
    expect(second[0]?.chunk.id).toBe("tools");
    expect(embedDocuments).toHaveBeenCalledOnce();
    expect(embedDocuments).toHaveBeenCalledWith(["tool registry", "sunny"]);
    expect(embedQuery).toHaveBeenCalledTimes(2);
  });

  it("only embeds chunks added after the first search", async () => {
    const embedDocuments = vi
      .fn()
      .mockResolvedValueOnce([[1, 0]])
      .mockResolvedValueOnce([[0, 1]]);
    const provider: EmbeddingProvider = {
      id: "fake",
      model: "fake-model",
      embedDocuments,
      embedQuery: vi.fn(async () => [1, 0]),
    };
    const retriever = createVectorRetriever(
      provider,
      createInMemoryVectorIndex(),
    );

    await retriever.retrieve("query", [chunk("first", "first text")], 1);
    await retriever.retrieve(
      "query",
      [chunk("first", "first text"), chunk("second", "second text")],
      2,
    );

    expect(embedDocuments.mock.calls).toEqual([
      [["first text"]],
      [["second text"]],
    ]);
  });

  it("re-embeds a chunk whose text changed under the same id", async () => {
    const embedDocuments = vi
      .fn()
      .mockResolvedValueOnce([[1, 0]])
      .mockResolvedValueOnce([[0, 1]]);
    const provider: EmbeddingProvider = {
      id: "fake",
      model: "fake-model",
      embedDocuments,
      embedQuery: vi.fn(async () => [1, 0]),
    };
    const retriever = createVectorRetriever(provider, createInMemoryVectorIndex());

    await retriever.retrieve("query", [chunk("same-id", "old text")], 1);
    await retriever.retrieve("query", [chunk("same-id", "new text")], 1);

    expect(embedDocuments.mock.calls).toEqual([[['old text']], [['new text']]]);
  });

  it("returns empty results without calling the provider for empty input", async () => {
    const embedDocuments = vi.fn(async () => []);
    const embedQuery = vi.fn(async () => [1, 0]);
    const provider: EmbeddingProvider = {
      id: "fake",
      model: "fake-model",
      embedDocuments,
      embedQuery,
    };
    const retriever = createVectorRetriever(
      provider,
      createInMemoryVectorIndex(),
    );

    await expect(retriever.retrieve(" ", [chunk("one", "text")], 5)).resolves.toEqual([]);
    await expect(retriever.retrieve("query", [], 5)).resolves.toEqual([]);
    await expect(retriever.retrieve("query", [chunk("one", "text")], 0)).resolves.toEqual([]);
    expect(embedDocuments).not.toHaveBeenCalled();
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it("serializes overlapping document-index synchronization", async () => {
    const firstEmbeddingStarted = deferred();
    const releaseFirstEmbedding = deferred();
    const embedDocuments = vi
      .fn<(texts: string[]) => Promise<number[][]>>()
      .mockImplementationOnce(async () => {
        firstEmbeddingStarted.resolve();
        await releaseFirstEmbedding.promise;
        return [[1, 0]];
      })
      .mockResolvedValueOnce([[0, 1]]);
    const retriever = createVectorRetriever(
      {
        id: "fake",
        model: "fake-model",
        embedDocuments,
        embedQuery: vi.fn(async () => [1, 0]),
      },
      createInMemoryVectorIndex(),
    );

    const first = retriever.retrieve("first", [chunk("one", "first text")], 1);
    await firstEmbeddingStarted.promise;
    const second = retriever.retrieve(
      "second",
      [chunk("one", "first text"), chunk("two", "second text")],
      2,
    );
    await Promise.resolve();

    expect(embedDocuments).toHaveBeenCalledTimes(1);
    releaseFirstEmbedding.resolve();
    await Promise.all([first, second]);
    expect(embedDocuments.mock.calls).toEqual([
      [["first text"]],
      [["second text"]],
    ]);
  });

  it("serializes clear behind an overlapping retrieval save", async () => {
    const embeddingStarted = deferred();
    const releaseEmbedding = deferred();
    const index = createInMemoryVectorIndex();
    const retriever = createVectorRetriever(
      {
        id: "fake",
        model: "fake-model",
        embedDocuments: vi.fn(async () => {
          embeddingStarted.resolve();
          await releaseEmbedding.promise;
          return [[1, 0]];
        }),
        embedQuery: vi.fn(async () => [1, 0]),
      },
      index,
    );

    const retrieval = retriever.retrieve("query", [chunk("one", "text")], 1);
    await embeddingStarted.promise;
    let clearFinished = false;
    const clear = retriever.clear().then(() => {
      clearFinished = true;
    });
    await Promise.resolve();
    expect(clearFinished).toBe(false);

    releaseEmbedding.resolve();
    await Promise.all([retrieval, clear]);
    expect(index.has("one", hashText("text"))).toBe(false);
  });
});
