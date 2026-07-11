import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  validateVector,
} from "../../src/main/rag/vector-math.js";

describe("validateVector", () => {
  it("accepts a finite non-empty vector", () => {
    expect(() => validateVector([1, 2, 3], "test vector")).not.toThrow();
  });

  it("rejects empty and non-finite vectors", () => {
    expect(() => validateVector([], "test vector")).toThrow(
      "test vector must not be empty",
    );
    expect(() => validateVector([1, Number.NaN], "test vector")).toThrow(
      "test vector contains a non-finite value at index 1",
    );
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for equal-direction vectors", () => {
    expect(cosineSimilarity([1, 2], [2, 4])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("rejects dimension mismatch and zero vectors", () => {
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(
      "Vector dimensions must match: 1 !== 2",
    );
    expect(() => cosineSimilarity([0, 0], [1, 0])).toThrow(
      "Cosine similarity is undefined for a zero vector",
    );
  });
});
