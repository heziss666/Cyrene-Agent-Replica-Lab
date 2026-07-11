import { validateVector } from "./vector-math.js";

export interface VectorIndex {
  has(chunkId: string): boolean;
  add(chunkId: string, vector: number[]): void;
  get(chunkId: string): number[] | undefined;
  clear(): void;
}

export function createInMemoryVectorIndex(): VectorIndex {
  const vectors = new Map<string, number[]>();
  let dimensions: number | undefined;

  return {
    has(chunkId) {
      return vectors.has(chunkId);
    },

    add(chunkId, vector) {
      validateVector(vector, `Vector for ${chunkId}`);
      if (dimensions !== undefined && vector.length !== dimensions) {
        throw new Error(
          `Vector dimension mismatch: expected ${dimensions}, received ${vector.length}`,
        );
      }
      dimensions ??= vector.length;
      vectors.set(chunkId, [...vector]);
    },

    get(chunkId) {
      const vector = vectors.get(chunkId);
      return vector ? [...vector] : undefined;
    },

    clear() {
      vectors.clear();
      dimensions = undefined;
    },
  };
}
