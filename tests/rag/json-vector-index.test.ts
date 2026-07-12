import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createJsonVectorIndex,
  type CreateJsonVectorIndexOptions,
  validateVectorIndexFile,
} from "../../src/main/rag/json-vector-index.js";
import { writeFileAtomically } from "../../src/main/rag/atomic-file-write.js";
import type {
  VectorIndexEntry,
  VectorIndexFile,
} from "../../src/main/rag/vector-index-types.js";

const identity = {
  providerId: "fake",
  model: "fake-model",
  schemaVersion: 1 as const,
};

const temporaryDirectories: string[] = [];
const HASH_ONE = "1".repeat(64);
const HASH_TWO = "2".repeat(64);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function validFile(entries: VectorIndexEntry[] = []): VectorIndexFile {
  return {
    schemaVersion: 1,
    embedding: { providerId: "fake", model: "fake-model", dimensions: 2 },
    chunking: { chunkSizeChars: 600, overlapChars: 120 },
    entries,
  };
}

async function createFilePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cyrene-json-vector-index-"));
  temporaryDirectories.push(directory);
  return join(directory, "vector-index.json");
}

function createIndex(
  filePath: string,
  logger = vi.fn(),
  overrides: Partial<CreateJsonVectorIndexOptions> = {},
) {
  return createJsonVectorIndex({
    filePath,
    identity,
    chunkSizeChars: 600,
    overlapChars: 120,
    logger,
    ...overrides,
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
      { chunkId: "one", textHash: HASH_ONE, vector: [1, 0] },
      { chunkId: "two", textHash: HASH_TWO, vector: [0, 1] },
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
    expect(second.get("one", HASH_ONE)).toEqual([1, 0]);

    await expect(
      second.prune([{ chunkId: "one", textHash: HASH_ONE }]),
    ).resolves.toBe(1);
    expect(JSON.parse(await readFile(filePath, "utf8")).entries).toHaveLength(1);

    await second.clear();
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects duplicate batch chunk ids", async () => {
    const missingFilePath = await createFilePath();
    await expect(
      createIndex(missingFilePath).addMany([
        { chunkId: "one", textHash: HASH_ONE, vector: [1, 0] },
        { chunkId: "one", textHash: HASH_TWO, vector: [0, 1] },
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
    await first.addMany([{ chunkId: "one", textHash: HASH_ONE, vector: [1, 0] }]);

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

    await index.addMany([{ chunkId: "one", textHash: HASH_ONE, vector: [1, 0] }]);

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
        entries: [{ chunkId: "one", textHash: HASH_ONE, vector: [] }],
      },
    },
    {
      description: "mismatched vector dimensions",
      file: {
        schemaVersion: 1,
        embedding: { providerId: "fake", model: "fake-model", dimensions: 2 },
        chunking: { chunkSizeChars: 600, overlapChars: 120 },
        entries: [{ chunkId: "one", textHash: HASH_ONE, vector: [1] }],
      },
    },
    {
      description: "duplicate chunk ids",
      file: {
        schemaVersion: 1,
        embedding: { providerId: "fake", model: "fake-model", dimensions: 1 },
        chunking: { chunkSizeChars: 600, overlapChars: 120 },
        entries: [
          { chunkId: "one", textHash: HASH_ONE, vector: [1] },
          { chunkId: "one", textHash: HASH_TWO, vector: [0] },
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
          entries: [{ chunkId: "one", textHash: HASH_ONE, vector: [value] }],
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
    entries[0] = { chunkId: "one", textHash: HASH_ONE, vector: [1, 0] };

    await expect(createIndex(filePath).addMany(entries)).rejects.toThrow(
      "Invalid vector index:",
    );
  });

  it("keeps addMany state unchanged when persistence fails, then retries", async () => {
    const filePath = await createFilePath();
    const persistenceError = new Error("disk full");
    const atomicWrite = vi
      .fn<(filePath: string, content: string) => Promise<void>>()
      .mockRejectedValueOnce(persistenceError)
      .mockImplementation((path, content) => writeFileAtomically(path, content));
    const index = createIndex(filePath, vi.fn(), { atomicWrite });
    const entry = { chunkId: "one", textHash: HASH_ONE, vector: [1, 0] };

    await expect(index.addMany([entry])).rejects.toBe(persistenceError);
    expect(index.has("one", HASH_ONE)).toBe(false);

    await expect(index.addMany([entry])).resolves.toBeUndefined();
    expect(index.has("one", HASH_ONE)).toBe(true);
    expect(JSON.parse(await readFile(filePath, "utf8")).entries).toHaveLength(1);
  });

  it("keeps prune state unchanged when persistence fails, then retries", async () => {
    const filePath = await createFilePath();
    const persistenceError = new Error("save failed");
    let writes = 0;
    const atomicWrite = vi.fn(async (path: string, content: string) => {
      writes += 1;
      if (writes === 2) throw persistenceError;
      await writeFileAtomically(path, content);
    });
    const index = createIndex(filePath, vi.fn(), { atomicWrite });
    await index.addMany([
      { chunkId: "one", textHash: HASH_ONE, vector: [1, 0] },
      { chunkId: "two", textHash: HASH_TWO, vector: [0, 1] },
    ]);

    await expect(
      index.prune([{ chunkId: "one", textHash: HASH_ONE }]),
    ).rejects.toBe(persistenceError);
    expect(index.has("two", HASH_TWO)).toBe(true);

    await expect(
      index.prune([{ chunkId: "one", textHash: HASH_ONE }]),
    ).resolves.toBe(1);
    expect(index.has("two", HASH_TWO)).toBe(false);
  });

  it("serializes clear behind an overlapping save", async () => {
    const filePath = await createFilePath();
    const saveStarted = deferred();
    const releaseSave = deferred();
    const atomicWrite = vi.fn(async (path: string, content: string) => {
      saveStarted.resolve();
      await releaseSave.promise;
      await writeFileAtomically(path, content);
    });
    const index = createIndex(filePath, vi.fn(), { atomicWrite });

    const save = index.addMany([
      { chunkId: "one", textHash: HASH_ONE, vector: [1, 0] },
    ]);
    const saveWasIntercepted = await Promise.race([
      saveStarted.promise.then(() => true),
      save.then(() => false),
    ]);
    expect(saveWasIntercepted).toBe(true);

    let clearFinished = false;
    const clear = index.clear().then(() => {
      clearFinished = true;
    });
    await Promise.resolve();
    expect(clearFinished).toBe(false);

    releaseSave.resolve();
    await Promise.all([save, clear]);
    expect(index.has("one", HASH_ONE)).toBe(false);
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("resets dimensions when pruning every entry", async () => {
    const filePath = await createFilePath();
    const index = createIndex(filePath);
    await index.addMany([
      { chunkId: "one", textHash: HASH_ONE, vector: [1, 0] },
    ]);

    await expect(index.prune([])).resolves.toBe(1);
    await expect(
      index.addMany([
        { chunkId: "two", textHash: HASH_TWO, vector: [1, 0, 0] },
      ]),
    ).resolves.toBeUndefined();

    expect(JSON.parse(await readFile(filePath, "utf8")).embedding.dimensions).toBe(3);
  });

  it("restores a backup and removes orphan temps when the formal file is absent", async () => {
    const filePath = await createFilePath();
    await writeFile(`${filePath}.bak`, JSON.stringify(validFile()), "utf8");
    await writeFile(`${filePath}.writer.tmp`, "orphan", "utf8");

    await expect(createIndex(filePath).initialize()).resolves.toEqual({
      status: "loaded",
      loadedEntries: 0,
    });

    expect(JSON.parse(await readFile(filePath, "utf8")).schemaVersion).toBe(1);
    expect(await readdir(dirname(filePath))).toEqual(["vector-index.json"]);
  });

  it("removes stale backups and temps after validating the formal file", async () => {
    const filePath = await createFilePath();
    await writeFile(filePath, JSON.stringify(validFile()), "utf8");
    await writeFile(`${filePath}.bak`, "stale backup", "utf8");
    await writeFile(`${filePath}.tmp`, "legacy temp", "utf8");
    await writeFile(`${filePath}.writer.tmp`, "writer temp", "utf8");

    await expect(createIndex(filePath).initialize()).resolves.toMatchObject({
      status: "loaded",
    });

    expect(await readdir(dirname(filePath))).toEqual(["vector-index.json"]);
  });

  it("removes orphan temps when neither formal nor backup exists", async () => {
    const filePath = await createFilePath();
    await writeFile(`${filePath}.writer.tmp`, "orphan", "utf8");

    await expect(createIndex(filePath).initialize()).resolves.toEqual({
      status: "missing",
      loadedEntries: 0,
    });

    expect(await readdir(dirname(filePath))).toEqual([]);
  });

  it.each([
    ["empty chunkId", { chunkId: "", textHash: HASH_ONE, vector: [1, 0] }, "chunkId must be a non-empty string"],
    ["uppercase hash", { chunkId: "one", textHash: "A".repeat(64), vector: [1, 0] }, "textHash must be exactly 64 lowercase hex characters"],
    ["short hash", { chunkId: "one", textHash: "abc", vector: [1, 0] }, "textHash must be exactly 64 lowercase hex characters"],
  ])("rejects an entry with %s", async (_description, entry, message) => {
    const filePath = await createFilePath();
    await expect(createIndex(filePath).addMany([entry])).rejects.toThrow(message);
  });

  it.each([
    ["empty provider", { providerId: "", model: "fake-model", dimensions: 2 }, "embedding.providerId must be a non-empty string"],
    ["empty model", { providerId: "fake", model: " ", dimensions: 2 }, "embedding.model must be a non-empty string"],
  ])("rejects persisted metadata with %s", (_description, embedding, message) => {
    expect(() => validateVectorIndexFile({
      ...validFile(),
      embedding,
    })).toThrow(message);
  });

  it("requires overlapChars to be smaller than chunkSizeChars", () => {
    expect(() => validateVectorIndexFile({
      ...validFile(),
      chunking: { chunkSizeChars: 600, overlapChars: 600 },
    })).toThrow("overlapChars must be smaller than chunkSizeChars");
    expect(() => createJsonVectorIndex({
      filePath: "unused.json",
      identity,
      chunkSizeChars: 600,
      overlapChars: 600,
    })).toThrow("overlapChars must be smaller than chunkSizeChars");
  });
});
