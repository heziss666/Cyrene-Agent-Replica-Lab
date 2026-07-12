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
import {
  VECTOR_INDEX_SCHEMA_VERSION,
  type VectorIndex,
} from "./vector-index-types.js";
import { createVectorRetriever } from "./vector-retriever.js";

const DEFAULT_DOCUMENTS: KnowledgeDocument[] = [
  {
    id: "seed_project_overview",
    title: "Cyrene Agent Replica Lab Overview",
    source: "seed",
    text:
      "Cyrene Agent Replica Lab is a TypeScript and Electron learning project for understanding agent development. " +
      "It has implemented OpenAI-compatible model calls, a ToolRegistry, function calling, AgentEvent tracing, " +
      "an Electron main/preload/renderer shell, and a multi-turn chat session.",
  },
  {
    id: "seed_tool_registry",
    title: "ToolRegistry",
    source: "seed",
    text:
      "ToolRegistry stores enabled tools, exposes their JSON schemas to the model, and executes tool calls requested by the model. " +
      "Built-in tools currently include time, calculator, echo, and search_knowledge.",
  },
  {
    id: "seed_minimal_rag",
    title: "Minimal RAG",
    source: "seed",
    text:
      "Minimal RAG stores local knowledge as text chunks. The search_knowledge tool retrieves relevant chunks and returns them to the model. " +
      "Phase 6B uses Ollama embeddings and vector search. Phase 6C persists document vectors for reuse across application restarts.",
  },
];

export interface CreateDefaultKnowledgeBaseOptions {
  embeddingProvider?: EmbeddingProvider;
  vectorIndex?: VectorIndex;
  storageConfig?: RagStorageConfig;
  logger?: (message: string) => void;
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
  return createKnowledgeBase(DEFAULT_DOCUMENTS, undefined, {
    vectorRetriever: createVectorRetriever(embeddingProvider, vectorIndex),
  });
}
