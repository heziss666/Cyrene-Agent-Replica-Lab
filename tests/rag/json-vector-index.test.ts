import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

  it("rejects duplicate batch chunk ids", async () => {
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

  it.each([
    {
      description: "model",
      options: { identity: { ...identity, model: "new-model" } },
      expectedReason: "model changed from fake-model to new-model",
    },
    {
      description: "provider",
      options: { identity: { ...identity, providerId: "other-provider" } },
      expectedReason: "provider changed from fake to other-provider",
    },
    {
      description: "chunk size",
      options: { chunkSizeChars: 700 },
      expectedReason: "chunkSizeChars changed from 600 to 700",
    },
    {
      description: "chunk overlap",
      options: { overlapChars: 80 },
      expectedReason: "overlapChars changed from 120 to 80",
    },
  ])("returns an empty incompatible state when the $description changes", async ({ options, expectedReason }) => {
    const filePath = await createFilePath();
    const first = createIndex(filePath);
    await first.addMany([{ chunkId: "one", textHash: "hash-one", vector: [1, 0] }]);

    const result = await createJsonVectorIndex({
      filePath,
      identity: options.identity ?? identity,
      chunkSizeChars: options.chunkSizeChars ?? 600,
      overlapChars: options.overlapChars ?? 120,
    }).initialize();

    expect(result.status).toBe("incompatible");
    expect(result.loadedEntries).toBe(0);
    expect(result.warning).toContain(expectedReason);
  });

  it("returns incompatible for a newer schema before validating its structure", async () => {
    const filePath = await createFilePath();
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 2,
        embedding: { providerId: "fake", model: "fake-model", dimensions: 2 },
        chunking: { chunkSizeChars: 600, overlapChars: 120 },
        entries: [],
      }),
      "utf8",
    );

    const result = await createIndex(filePath).initialize();

    expect(result.status).toBe("incompatible");
    expect(result.loadedEntries).toBe(0);
    expect(result.warning).toContain("schemaVersion changed from 2 to 1");
  });

  it("backs up malformed JSON and rebuilds a valid index while preserving the backup", async () => {
    const filePath = await createFilePath();
    await writeFile(filePath, "{ not valid JSON", "utf8");
    const index = createIndex(filePath);

    const firstInitialization = index.initialize();
    expect(index.initialize()).toBe(firstInitialization);
    const result = await firstInitialization;

    expect(result.status).toBe("corrupt");
    expect(result.loadedEntries).toBe(0);
    expect(result.warning).toContain("backup created at");
    const backupNames = (await readdir(dirname(filePath))).filter((name) =>
      /^vector-index\.corrupt-\d+\.json$/.test(name),
    );
    expect(backupNames).toHaveLength(1);
    const backupPath = join(dirname(filePath), backupNames[0]);
    expect(await readFile(backupPath, "utf8")).toBe("{ not valid JSON");

    await index.addMany([{ chunkId: "one", textHash: "hash-one", vector: [1, 0] }]);

    const rebuilt = JSON.parse(await readFile(filePath, "utf8"));
    expect(() => validateVectorIndexFile(rebuilt)).not.toThrow();
    expect(await readFile(backupPath, "utf8")).toBe("{ not valid JSON");
  });

  it.each([
    {
      description: "a missing entries field",
      file: {
        schemaVersion: 1,
        embedding: { providerId: "fake", model: "fake-model", dimensions: 2 },
        chunking: { chunkSizeChars: 600, overlapChars: 120 },
      },
    },
    {
      description: "an empty vector",
      file: {
        schemaVersion: 1,
        embedding: { providerId: "fake", model: "fake-model", dimensions: 1 },
        chunking: { chunkSizeChars: 600, overlapChars: 120 },
        entries: [{ chunkId: "one", textHash: "hash-one", vector: [] }],
      },
    },
    {
      description: "mismatched vector dimensions",
      file: {
        schemaVersion: 1,
        embedding: { providerId: "fake", model: "fake-model", dimensions: 2 },
        chunking: { chunkSizeChars: 600, overlapChars: 120 },
        entries: [{ chunkId: "one", textHash: "hash-one", vector: [1] }],
      },
    },
    {
      description: "duplicate chunk ids",
      file: {
        schemaVersion: 1,
        embedding: { providerId: "fake", model: "fake-model", dimensions: 1 },
        chunking: { chunkSizeChars: 600, overlapChars: 120 },
        entries: [
          { chunkId: "one", textHash: "hash-one", vector: [1] },
          { chunkId: "one", textHash: "hash-two", vector: [0] },
        ],
      },
    },
  ])("backs up and returns corrupt for $description", async ({ file }) => {
    const filePath = await createFilePath();
    await writeFile(filePath, JSON.stringify(file), "utf8");

    const result = await createIndex(filePath).initialize();

    expect(result.status).toBe("corrupt");
    expect(result.loadedEntries).toBe(0);
    expect(result.warning).toContain("backup created at");
    expect((await readdir(dirname(filePath))).some((name) => /^vector-index\.corrupt-\d+\.json$/.test(name))).toBe(
      true,
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a non-finite vector value supplied directly to the validator",
    (value) => {
      expect(() =>
        validateVectorIndexFile({
          schemaVersion: 1,
          embedding: { providerId: "fake", model: "fake-model", dimensions: 1 },
          chunking: { chunkSizeChars: 600, overlapChars: 120 },
          entries: [{ chunkId: "one", textHash: "hash-one", vector: [value] }],
        }),
      ).toThrow("contains a non-finite value");
    },
  );

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
