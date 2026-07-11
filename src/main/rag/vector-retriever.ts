import type { EmbeddingProvider } from "./embedding-provider.js";
import type { VectorIndex } from "./in-memory-vector-index.js";
import type { KnowledgeChunk, KnowledgeSearchResult } from "./rag-types.js";
import { cosineSimilarity } from "./vector-math.js";

export interface VectorRetriever {
  readonly model: string;
  retrieve(
    query: string,
    chunks: KnowledgeChunk[],
    topK?: number,
  ): Promise<KnowledgeSearchResult[]>;
  clear(): void;
}

export function createVectorRetriever(
  provider: EmbeddingProvider,
  index: VectorIndex,
): VectorRetriever {
  return {
    model: provider.model,

    async retrieve(query, chunks, topK = 5) {
      const normalizedQuery = query.trim();
      if (!normalizedQuery || chunks.length === 0 || topK <= 0) return [];

      const missingChunks = chunks.filter((chunk) => !index.has(chunk.id));
      if (missingChunks.length > 0) {
        const vectors = await provider.embedDocuments(
          missingChunks.map((chunk) => chunk.text),
        );
        if (vectors.length !== missingChunks.length) {
          throw new Error(
            `Embedding provider returned ${vectors.length} vectors for ${missingChunks.length} chunks`,
          );
        }
        missingChunks.forEach((chunk, chunkIndex) => {
          index.add(chunk.id, vectors[chunkIndex]);
        });
      }

      const queryVector = await provider.embedQuery(normalizedQuery);
      return chunks
        .map((chunk) => {
          const vector = index.get(chunk.id);
          if (!vector) throw new Error(`Missing vector for chunk: ${chunk.id}`);
          return {
            chunk,
            score: cosineSimilarity(queryVector, vector),
          };
        })
        .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
        .slice(0, topK);
    },

    clear() {
      index.clear();
    },
  };
}
