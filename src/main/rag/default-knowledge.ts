import { loadEmbeddingConfig } from "../config/embedding-config.js";
import {
  loadRagStorageConfig,
  type RagStorageConfig,
} from "../config/rag-storage-config.js";
import {
  DEFAULT_CHUNK_SIZE_CHARS,
  DEFAULT_OVERLAP_CHARS,
} from "./chunk-text.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { createJsonVectorIndex } from "./json-vector-index.js";
import { createKnowledgeBase, type KnowledgeBase } from "./knowledge-base.js";
import { createOllamaEmbeddingProvider } from "./ollama-embedding-provider.js";
import type { KnowledgeDocument } from "./rag-types.js";
import { loadCyreneKnowledgeDocuments } from "./cyrene-knowledge.js";
import {
  VECTOR_INDEX_SCHEMA_VERSION,
  type VectorIndex,
} from "./vector-index-types.js";
import { createVectorRetriever } from "./vector-retriever.js";

export interface CreateDefaultKnowledgeBaseOptions {
  embeddingProvider?: EmbeddingProvider;
  vectorIndex?: VectorIndex;
  storageConfig?: RagStorageConfig;
  logger?: (message: string) => void;
  knowledgeDir?: string;
}

export function createDefaultKnowledgeBase(
  options: CreateDefaultKnowledgeBaseOptions = {},
): KnowledgeBase {
  const embeddingProvider = options.embeddingProvider
    ?? createOllamaEmbeddingProvider(loadEmbeddingConfig());
  const storageConfig = options.storageConfig ?? loadRagStorageConfig();
  const vectorIndex = options.vectorIndex ?? createJsonVectorIndex({
    filePath: storageConfig.vectorIndexPath,
    identity: {
      providerId: embeddingProvider.id,
      model: embeddingProvider.model,
      schemaVersion: VECTOR_INDEX_SCHEMA_VERSION,
    },
    chunkSizeChars: DEFAULT_CHUNK_SIZE_CHARS,
    overlapChars: DEFAULT_OVERLAP_CHARS,
    logger: options.logger,
  });
  const documents: KnowledgeDocument[] = loadCyreneKnowledgeDocuments(options.knowledgeDir);
  return createKnowledgeBase(documents, undefined, {
    vectorRetriever: createVectorRetriever(embeddingProvider, vectorIndex),
  });
}
