import type { EmbeddingProvider } from "./embedding-provider.js";
import type { KnowledgeChunk, KnowledgeSearchResult } from "./rag-types.js";
import { hashText } from "./text-hash.js";
import type { VectorIndex } from "./vector-index-types.js";
import { cosineSimilarity } from "./vector-math.js";

export interface VectorRetriever {
  readonly model: string;
  retrieve(
    query: string,
    chunks: KnowledgeChunk[],
    topK?: number,
  ): Promise<KnowledgeSearchResult[]>;
  clear(): Promise<void>;
}

interface IndexedChunk {
  chunk: KnowledgeChunk;
  textHash: string;
}

function createSerialExecutor() {
  let tail = Promise.resolve();
  return function serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

export function createVectorRetriever(
  provider: EmbeddingProvider,
  index: VectorIndex,
): VectorRetriever {
  const serialize = createSerialExecutor();

  async function prepareIndex(indexedChunks: IndexedChunk[]) {
    await index.initialize();
    await index.prune(
      indexedChunks.map(({ chunk, textHash }) => ({
        chunkId: chunk.id,
        textHash,
      })),
    );

  }

  async function addMissingDocuments(
    indexedChunks: IndexedChunk[],
    expectedDimensions: number,
  ): Promise<boolean> {
    const missing = indexedChunks.filter(
      ({ chunk, textHash }) => !index.has(chunk.id, textHash),
    );
    if (missing.length === 0) return true;

    const vectors = await provider.embedDocuments(
      missing.map(({ chunk }) => chunk.text),
    );
    if (vectors.length !== missing.length) {
      throw new Error(
        `Embedding provider returned ${vectors.length} vectors for ${missing.length} chunks`,
      );
    }
    if (vectors.some((vector) => vector.length !== expectedDimensions)) {
      return false;
    }
    await index.addMany(
      missing.map(({ chunk, textHash }, vectorIndex) => ({
        chunkId: chunk.id,
        textHash,
        vector: vectors[vectorIndex],
      })),
    );
    return true;
  }

  function getStoredVector(indexedChunk: IndexedChunk): number[] {
    const { chunk, textHash } = indexedChunk;
    const vector = index.get(chunk.id, textHash);
    if (!vector) throw new Error(`Missing vector for chunk: ${chunk.id}`);
    return vector;
  }

  return {
    model: provider.model,

    retrieve(query, chunks, topK = 5) {
      const normalizedQuery = query.trim();
      if (!normalizedQuery || chunks.length === 0 || topK <= 0) {
        return Promise.resolve([]);
      }

      return serialize(async () => {
        const indexedChunks = chunks.map((chunk) => ({
          chunk,
          textHash: hashText(chunk.text),
        }));
        await prepareIndex(indexedChunks);
        const queryVector = await provider.embedQuery(normalizedQuery);
        const storedVector = indexedChunks
          .map(({ chunk, textHash }) => index.get(chunk.id, textHash))
          .find((vector) => vector !== undefined);
        let rebuilt = false;
        if (storedVector && queryVector.length !== storedVector.length) {
          await index.clear();
          await prepareIndex(indexedChunks);
          rebuilt = true;
        }

        let dimensionsMatch = await addMissingDocuments(
          indexedChunks,
          queryVector.length,
        );
        if (!dimensionsMatch && storedVector && !rebuilt) {
          await index.clear();
          await prepareIndex(indexedChunks);
          rebuilt = true;
          dimensionsMatch = await addMissingDocuments(
            indexedChunks,
            queryVector.length,
          );
        }
        if (!dimensionsMatch) {
          throw new Error(
            `Embedding dimensions remain inconsistent after rebuild: query ${queryVector.length}`,
          );
        }

        return indexedChunks
          .map((indexedChunk) => ({
            chunk: indexedChunk.chunk,
            score: cosineSimilarity(queryVector, getStoredVector(indexedChunk)),
          }))
          .sort(
            (a, b) =>
              b.score - a.score || a.chunk.id.localeCompare(b.chunk.id),
          )
          .slice(0, topK);
      });
    },

    clear() {
      return serialize(() => index.clear());
    },
  };
}
