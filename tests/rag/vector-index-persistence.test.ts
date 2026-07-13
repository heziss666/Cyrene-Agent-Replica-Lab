import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../../src/main/rag/embedding-provider.js";
import { createJsonVectorIndex } from "../../src/main/rag/json-vector-index.js";
import type { KnowledgeChunk } from "../../src/main/rag/rag-types.js";
import { hashText } from "../../src/main/rag/text-hash.js";
import type { VectorIndexFile } from "../../src/main/rag/vector-index-types.js";
import { createVectorRetriever } from "../../src/main/rag/vector-retriever.js";

const temporaryDirectories: string[] = [];

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

async function createFilePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cyrene-vector-persistence-"));
  temporaryDirectories.push(directory);
  return join(directory, "vector-index.json");
}

function persistentIndex(filePath: string, model = "fake-model") {
  return createJsonVectorIndex({
    filePath,
    identity: { providerId: "fake", model, schemaVersion: 1 },
    chunkSizeChars: 600,
    overlapChars: 120,
    logger: vi.fn(),
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("persisted vector indexes", () => {
  it("reuses unchanged document vectors after a restart", async () => {
    const filePath = await createFilePath();
    const firstEmbedDocuments = vi.fn(async () => [[1, 0]]);
    const firstRetriever = createVectorRetriever(
      {
        id: "fake",
        model: "fake-model",
        embedDocuments: firstEmbedDocuments,
        embedQuery: vi.fn(async () => [1, 0]),
      },
      persistentIndex(filePath),
    );

    await firstRetriever.retrieve("first query", [chunk("tools", "tool registry")], 1);
    expect(firstEmbedDocuments).toHaveBeenCalledOnce();

    const secondEmbedDocuments = vi.fn(async () => {
      throw new Error("document embeddings should have been reused");
    });
    const secondEmbedQuery = vi.fn(async () => [1, 0]);
    const secondRetriever = createVectorRetriever(
      {
        id: "fake",
        model: "fake-model",
        embedDocuments: secondEmbedDocuments,
        embedQuery: secondEmbedQuery,
      },
      persistentIndex(filePath),
    );

    const results = await secondRetriever.retrieve(
      "second query",
      [chunk("tools", "tool registry")],
      1,
    );

    expect(results[0]?.chunk.id).toBe("tools");
    expect(secondEmbedDocuments).not.toHaveBeenCalled();
    expect(secondEmbedQuery).toHaveBeenCalledOnce();
  });

  it("re-embeds changed chunks and prunes removed chunks after a restart", async () => {
    const filePath = await createFilePath();
    const firstRetriever = createVectorRetriever(
      {
        id: "fake",
        model: "fake-model",
        embedDocuments: vi.fn(async () => [[1, 0], [0, 1], [1, 1]]),
        embedQuery: vi.fn(async () => [1, 0]),
      },
      persistentIndex(filePath),
    );

    await firstRetriever.retrieve(
      "first query",
      [
        chunk("keep", "unchanged text"),
        chunk("change", "old changed text"),
        chunk("remove", "removed text"),
      ],
      3,
    );

    const secondEmbedDocuments = vi.fn(async () => [[0, 1]]);
    const secondRetriever = createVectorRetriever(
      {
        id: "fake",
        model: "fake-model",
        embedDocuments: secondEmbedDocuments,
        embedQuery: vi.fn(async () => [1, 0]),
      },
      persistentIndex(filePath),
    );

    await secondRetriever.retrieve(
      "second query",
      [chunk("keep", "unchanged text"), chunk("change", "new changed text")],
      2,
    );

    expect(secondEmbedDocuments).toHaveBeenCalledOnce();
    expect(secondEmbedDocuments).toHaveBeenCalledWith(["new changed text"]);

    const saved = JSON.parse(await readFile(filePath, "utf8")) as VectorIndexFile;
    expect(saved.entries.map((entry) => entry.chunkId).sort()).toEqual([
      "change",
      "keep",
    ]);
    expect(saved.entries.find((entry) => entry.chunkId === "change")?.textHash).toBe(
      hashText("new changed text"),
    );
  });

  it("rebuilds every current document vector when the model changes", async () => {
    const filePath = await createFilePath();
    const chunks = [chunk("tools", "tool registry"), chunk("weather", "weather tool")];
    const firstProvider: EmbeddingProvider = {
      id: "fake",
      model: "old-model",
      embedDocuments: vi.fn(async () => [[1, 0], [0, 1]]),
      embedQuery: vi.fn(async () => [1, 0]),
    };
    const firstRetriever = createVectorRetriever(
      firstProvider,
      persistentIndex(filePath, "old-model"),
    );

    await firstRetriever.retrieve("first query", chunks, 2);

    const secondEmbedDocuments = vi.fn(async () => [[1, 0], [0, 1]]);
    const secondRetriever = createVectorRetriever(
      {
        id: "fake",
        model: "new-model",
        embedDocuments: secondEmbedDocuments,
        embedQuery: vi.fn(async () => [1, 0]),
      },
      persistentIndex(filePath, "new-model"),
    );

    await secondRetriever.retrieve("second query", chunks, 2);

    expect(secondEmbedDocuments).toHaveBeenCalledOnce();
    expect(secondEmbedDocuments).toHaveBeenCalledWith(["tool registry", "weather tool"]);
  });

  it("rebuilds once when the same provider and model change dimensions", async () => {
    const filePath = await createFilePath();
    const chunks = [chunk("tools", "tool registry"), chunk("weather", "weather tool")];
    await createVectorRetriever(
      {
        id: "fake",
        model: "fake-model",
        embedDocuments: vi.fn(async () => [[1, 0], [0, 1]]),
        embedQuery: vi.fn(async () => [1, 0]),
      },
      persistentIndex(filePath),
    ).retrieve("first query", chunks, 2);

    const embedDocuments = vi.fn(async () => [[1, 0, 0], [0, 1, 0]]);
    const embedQuery = vi.fn(async () => [1, 0, 0]);
    const results = await createVectorRetriever(
      {
        id: "fake",
        model: "fake-model",
        embedDocuments,
        embedQuery,
      },
      persistentIndex(filePath),
    ).retrieve("second query", chunks, 2);

    expect(results).toHaveLength(2);
    expect(embedQuery).toHaveBeenCalledOnce();
    expect(embedDocuments).toHaveBeenCalledOnce();
    expect(embedDocuments).toHaveBeenCalledWith(["tool registry", "weather tool"]);
    const saved = JSON.parse(await readFile(filePath, "utf8")) as VectorIndexFile;
    expect(saved.embedding.dimensions).toBe(3);
    expect(saved.entries.every((entry) => entry.vector.length === 3)).toBe(true);
  });

  it("detects dimension drift before incrementally saving a new chunk", async () => {
    const filePath = await createFilePath();
    await createVectorRetriever(
      {
        id: "fake",
        model: "fake-model",
        embedDocuments: vi.fn(async () => [[1, 0]]),
        embedQuery: vi.fn(async () => [1, 0]),
      },
      persistentIndex(filePath),
    ).retrieve("first query", [chunk("tools", "tool registry")], 1);

    const embedDocuments = vi.fn(async (texts: string[]) =>
      texts.map((_, index) => index === 0 ? [1, 0, 0] : [0, 1, 0]),
    );
    await createVectorRetriever(
      {
        id: "fake",
        model: "fake-model",
        embedDocuments,
        embedQuery: vi.fn(async () => [1, 0, 0]),
      },
      persistentIndex(filePath),
    ).retrieve(
      "second query",
      [chunk("tools", "tool registry"), chunk("weather", "weather tool")],
      2,
    );

    expect(embedDocuments).toHaveBeenCalledOnce();
    expect(embedDocuments).toHaveBeenCalledWith(["tool registry", "weather tool"]);
    const saved = JSON.parse(await readFile(filePath, "utf8")) as VectorIndexFile;
    expect(saved.embedding.dimensions).toBe(3);
    expect(saved.entries).toHaveLength(2);
  });
});
