import { describe, expect, it } from "vitest";
import { createInMemoryVectorIndex } from "../../src/main/rag/in-memory-vector-index.js";

describe("createInMemoryVectorIndex", () => {
  it("initializes once and stores defensive copies", async () => {
    const index = createInMemoryVectorIndex();
    const firstInitialization = index.initialize();
    const secondInitialization = index.initialize();
    expect(secondInitialization).toBe(firstInitialization);
    await expect(firstInitialization).resolves.toEqual({
      status: "missing",
      loadedEntries: 0,
    });

    const vector = [1, 2, 3];
    await index.addMany([{ chunkId: "one", textHash: "hash-one", vector }]);
    vector[0] = 99;
    const firstRead = index.get("one", "hash-one");
    firstRead![1] = 88;
    expect(index.get("one", "hash-one")).toEqual([1, 2, 3]);
  });

  it("requires both chunk id and text hash", async () => {
    const index = createInMemoryVectorIndex();
    await index.addMany([
      { chunkId: "one", textHash: "current", vector: [1, 0] },
    ]);

    expect(index.has("one", "current")).toBe(true);
    expect(index.has("one", "old")).toBe(false);
    expect(index.get("one", "old")).toBeUndefined();
  });

  it("rejects inconsistent dimensions for a batch", async () => {
    const index = createInMemoryVectorIndex();
    await expect(
      index.addMany([
        { chunkId: "one", textHash: "one", vector: [1, 2] },
        { chunkId: "two", textHash: "two", vector: [1, 2, 3] },
      ]),
    ).rejects.toThrow("Vector dimension mismatch: expected 2, received 3");
  });

  it("prunes removed and modified entries", async () => {
    const index = createInMemoryVectorIndex();
    await index.addMany([
      { chunkId: "keep", textHash: "same", vector: [1, 0] },
      { chunkId: "modified", textHash: "old", vector: [0, 1] },
      { chunkId: "removed", textHash: "gone", vector: [1, 1] },
    ]);

    await expect(
      index.prune([
        { chunkId: "keep", textHash: "same" },
        { chunkId: "modified", textHash: "new" },
      ]),
    ).resolves.toBe(2);
    expect(index.has("keep", "same")).toBe(true);
    expect(index.has("modified", "old")).toBe(false);
    expect(index.has("removed", "gone")).toBe(false);
  });

  it("clears entries and resets dimensions", async () => {
    const index = createInMemoryVectorIndex();
    await index.addMany([{ chunkId: "one", textHash: "one", vector: [1, 2] }]);
    await index.clear();
    await index.addMany([
      { chunkId: "two", textHash: "two", vector: [1, 2, 3] },
    ]);
    expect(index.has("one", "one")).toBe(false);
    expect(index.get("two", "two")).toEqual([1, 2, 3]);
  });
});
