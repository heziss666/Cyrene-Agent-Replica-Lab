import { validateVector } from "./vector-math.js";
import type {
  VectorIndex,
  VectorIndexEntry,
  VectorIndexEntryKey,
} from "./vector-index-types.js";

function cloneEntry(entry: VectorIndexEntry): VectorIndexEntry {
  return { ...entry, vector: [...entry.vector] };
}

export function createInMemoryVectorIndex(): VectorIndex {
  const entries = new Map<string, VectorIndexEntry>();
  let dimensions: number | undefined;
  const initialization = Promise.resolve({
    status: "missing" as const,
    loadedEntries: 0,
  });

  function validateEntry(entry: VectorIndexEntry): void {
    validateVector(entry.vector, `Vector for ${entry.chunkId}`);
    if (dimensions !== undefined && entry.vector.length !== dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${dimensions}, received ${entry.vector.length}`,
      );
    }
    dimensions ??= entry.vector.length;
  }

  return {
    initialize() {
      return initialization;
    },

    has(chunkId, textHash) {
      return entries.get(chunkId)?.textHash === textHash;
    },

    get(chunkId, textHash) {
      const entry = entries.get(chunkId);
      return entry?.textHash === textHash ? [...entry.vector] : undefined;
    },

    async addMany(nextEntries) {
      const originalDimensions = dimensions;
      try {
        for (const entry of nextEntries) validateEntry(entry);
      } catch (error) {
        dimensions = originalDimensions;
        throw error;
      }
      for (const entry of nextEntries) entries.set(entry.chunkId, cloneEntry(entry));
    },

    async prune(validEntries: VectorIndexEntryKey[]) {
      const valid = new Map(validEntries.map((entry) => [entry.chunkId, entry.textHash]));
      let removed = 0;
      for (const [chunkId, entry] of entries) {
        if (valid.get(chunkId) !== entry.textHash) {
          entries.delete(chunkId);
          removed += 1;
        }
      }
      if (entries.size === 0) dimensions = undefined;
      return removed;
    },

    async clear() {
      entries.clear();
      dimensions = undefined;
    },
  };
}
