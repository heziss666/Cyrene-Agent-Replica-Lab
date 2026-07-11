import type { EmbeddingProvider } from "./embedding-provider.js";
import { hashText } from "./text-hash.js";
import type { VectorIndex } from "./vector-index-types.js";
import type { KnowledgeChunk, KnowledgeSearchResult } from "./rag-types.js";
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

export function createVectorRetriever(
  provider: EmbeddingProvider,
  index: VectorIndex,
): VectorRetriever {
  return {
    model: provider.model,

    async retrieve(query, chunks, topK = 5) {
      const normalizedQuery = query.trim();
      if (!normalizedQuery || chunks.length === 0 || topK <= 0) return [];

      await index.initialize();
      const indexedChunks = chunks.map((chunk) => ({
        chunk,
        textHash: hashText(chunk.text),
      }));
      await index.prune(
        indexedChunks.map(({ chunk, textHash }) => ({
          chunkId: chunk.id,
          textHash,
        })),
      );

      const missing = indexedChunks.filter(
        ({ chunk, textHash }) => !index.has(chunk.id, textHash),
      );
      if (missing.length > 0) {
        const vectors = await provider.embedDocuments(
          missing.map(({ chunk }) => chunk.text),
        );
        if (vectors.length !== missing.length) {
          throw new Error(
            `Embedding provider returned ${vectors.length} vectors for ${missing.length} chunks`,
          );
        }
        await index.addMany(
          missing.map(({ chunk, textHash }, vectorIndex) => ({
            chunkId: chunk.id,
            textHash,
            vector: vectors[vectorIndex],
          })),
        );
      }

      const queryVector = await provider.embedQuery(normalizedQuery);
      return indexedChunks
        .map(({ chunk, textHash }) => {
          const vector = index.get(chunk.id, textHash);
          if (!vector) throw new Error(`Missing vector for chunk: ${chunk.id}`);
          return { chunk, score: cosineSimilarity(queryVector, vector) };
        })
        .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
        .slice(0, topK);
    },

    clear() {
      return index.clear();
    },
  };
}
