import { describe, expect, it } from "vitest";
import { createInMemoryVectorIndex } from "../../src/main/rag/in-memory-vector-index.js";

describe("createInMemoryVectorIndex", () => {
  it("stores and returns a defensive copy", () => {
    const index = createInMemoryVectorIndex();
    const source = [1, 2, 3];
    index.add("chunk_1", source);
    source[0] = 99;

    const firstRead = index.get("chunk_1");
    expect(firstRead).toEqual([1, 2, 3]);
    firstRead![1] = 88;
    expect(index.get("chunk_1")).toEqual([1, 2, 3]);
  });

  it("tracks ids and rejects dimension changes", () => {
    const index = createInMemoryVectorIndex();
    index.add("chunk_1", [1, 2]);

    expect(index.has("chunk_1")).toBe(true);
    expect(index.has("missing")).toBe(false);
    expect(() => index.add("chunk_2", [1, 2, 3])).toThrow(
      "Vector dimension mismatch: expected 2, received 3",
    );
  });

  it("clears vectors and resets the dimension", () => {
    const index = createInMemoryVectorIndex();
    index.add("chunk_1", [1, 2]);
    index.clear();
    index.add("chunk_2", [1, 2, 3]);

    expect(index.has("chunk_1")).toBe(false);
    expect(index.get("chunk_2")).toEqual([1, 2, 3]);
  });
});
