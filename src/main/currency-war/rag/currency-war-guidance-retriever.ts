import { loadEmbeddingConfig } from "../../config/embedding-config.js";
import { loadRagStorageConfig } from "../../config/rag-storage-config.js";
import { DEFAULT_CHUNK_SIZE_CHARS, DEFAULT_OVERLAP_CHARS } from "../../rag/chunk-text.js";
import type { EmbeddingProvider } from "../../rag/embedding-provider.js";
import { createJsonVectorIndex } from "../../rag/json-vector-index.js";
import { createKnowledgeBase, type KnowledgeBase } from "../../rag/knowledge-base.js";
import { createOllamaEmbeddingProvider } from "../../rag/ollama-embedding-provider.js";
import type { KnowledgeSearchResponse } from "../../rag/rag-types.js";
import { VECTOR_INDEX_SCHEMA_VERSION, type VectorIndex } from "../../rag/vector-index-types.js";
import { createVectorRetriever } from "../../rag/vector-retriever.js";
import { loadCurrencyWarGuidanceDocuments } from "./currency-war-knowledge.js";

export interface CurrencyWarGuidanceRetriever {
  search(query: string, topK?: number): Promise<KnowledgeSearchResponse>;
}

export interface CreateCurrencyWarGuidanceRetrieverOptions {
  embeddingProvider?: EmbeddingProvider;
  vectorIndex?: VectorIndex;
  knowledgeBase?: KnowledgeBase;
}

export function createCurrencyWarGuidanceRetriever(
  options: CreateCurrencyWarGuidanceRetrieverOptions = {},
): CurrencyWarGuidanceRetriever {
  const knowledgeBase = options.knowledgeBase ?? (() => {
    const embeddingProvider = options.embeddingProvider
      ?? createOllamaEmbeddingProvider(loadEmbeddingConfig());
    const storage = loadRagStorageConfig();
    const vectorIndex = options.vectorIndex ?? createJsonVectorIndex({
      filePath: `${storage.dataDir}/currency-war-general-guidance-vector-index.json`,
      identity: {
        providerId: embeddingProvider.id,
        model: embeddingProvider.model,
        schemaVersion: VECTOR_INDEX_SCHEMA_VERSION,
      },
      chunkSizeChars: DEFAULT_CHUNK_SIZE_CHARS,
      overlapChars: DEFAULT_OVERLAP_CHARS,
    });
    return createKnowledgeBase(loadCurrencyWarGuidanceDocuments(), undefined, {
      vectorRetriever: createVectorRetriever(embeddingProvider, vectorIndex),
    });
  })();

  return { search: (query, topK = 3) => knowledgeBase.search(query, topK) };
}
