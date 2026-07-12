import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createJsonVectorIndex,
  validateVectorIndexFile,
} from "../../src/main/rag/json-vector-index.js";

const identity = {
  providerId: "fake",
  model: "fake-model",
  schemaVersion: 1 as const,
};

const temporaryDirectories: string[] = [];

async function createFilePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cyrene-json-vector-index-"));
  temporaryDirectories.push(directory);
  return join(directory, "vector-index.json");
}

function createIndex(filePath: string, logger = vi.fn()) {
  return createJsonVectorIndex({
    filePath,
    identity,
    chunkSizeChars: 600,
    overlapChars: 120,
    logger,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("createJsonVectorIndex", () => {
  it("loads, saves, prunes, and clears a JSON vector index", async () => {
    const filePath = await createFilePath();
    const logger = vi.fn();
    const first = createIndex(filePath, logger);

    await expect(first.initialize()).resolves.toEqual({
      status: "missing",
      loadedEntries: 0,
    });
    await first.addMany([
      { chunkId: "one", textHash: "hash-one", vector: [1, 0] },
      { chunkId: "two", textHash: "hash-two", vector: [0, 1] },
    ]);

    const saved = JSON.parse(await readFile(filePath, "utf8"));
    expect(saved.embedding).toEqual({
      providerId: "fake",
      model: "fake-model",
      dimensions: 2,
    });
    expect(saved.chunking).toEqual({ chunkSizeChars: 600, overlapChars: 120 });
    expect(saved.entries).toHaveLength(2);
    expect(
      logger.mock.calls.filter(([message]) => message.includes("vector index saved")).map(([message]) => message),
    ).toEqual(["[RAG] vector index saved: 2 entries"]);

    const second = createIndex(filePath);
    await expect(second.initialize()).resolves.toEqual({
      status: "loaded",
      loadedEntries: 2,
    });
    expect(second.get("one", "hash-one")).toEqual([1, 0]);

    await expect(
      second.prune([{ chunkId: "one", textHash: "hash-one" }]),
    ).resolves.toBe(1);
    expect(JSON.parse(await readFile(filePath, "utf8")).entries).toHaveLength(1);

    await second.clear();
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects invalid persisted entries and duplicate batch chunk ids", async () => {
    const filePath = await createFilePath();
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        embedding: { providerId: "fake", model: "fake-model", dimensions: 2 },
        chunking: { chunkSizeChars: 600, overlapChars: 120 },
        entries: {},
      }),
      "utf8",
    );

    await expect(createIndex(filePath).initialize()).rejects.toThrow(
      "Invalid vector index: entries must be an array",
    );

    const missingFilePath = await createFilePath();
    await expect(
      createIndex(missingFilePath).addMany([
        { chunkId: "one", textHash: "hash-one", vector: [1, 0] },
        { chunkId: "one", textHash: "hash-two", vector: [0, 1] },
      ]),
    ).rejects.toThrow("Invalid vector index: duplicate chunkId: one");
  });

  it("reloads an index with zero chunk overlap", async () => {
    const filePath = await createFilePath();
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        embedding: { providerId: "fake", model: "fake-model", dimensions: 2 },
        chunking: { chunkSizeChars: 600, overlapChars: 0 },
        entries: [],
      }),
      "utf8",
    );

    const index = createJsonVectorIndex({
      filePath,
      identity,
      chunkSizeChars: 600,
      overlapChars: 0,
    });
    await expect(index.initialize()).resolves.toEqual({
      status: "loaded",
      loadedEntries: 0,
    });
  });

  it("rejects a custom-prototype vector index file", () => {
    class VectorIndexFileLike {
      schemaVersion = 1;
      embedding = { providerId: "fake", model: "fake-model", dimensions: 2 };
      chunking = { chunkSizeChars: 600, overlapChars: 120 };
      entries: unknown[] = [];
    }

    expect(() => validateVectorIndexFile(new VectorIndexFileLike())).toThrow(
      "Invalid vector index:",
    );
  });

  it("rejects a sparse addMany batch with a validation error", async () => {
    const filePath = await createFilePath();
    const entries = new Array<{
      chunkId: string;
      textHash: string;
      vector: number[];
    }>(2);
    entries[0] = { chunkId: "one", textHash: "hash-one", vector: [1, 0] };

    await expect(createIndex(filePath).addMany(entries)).rejects.toThrow(
      "Invalid vector index:",
    );
  });
});
