import { join } from "node:path";
import { loadEmbeddingConfig } from "../config/embedding-config.js";
import {
  loadRagStorageConfig,
  type RagStorageConfig,
} from "../config/rag-storage-config.js";
import {
  DEFAULT_CHUNK_SIZE_CHARS,
  DEFAULT_OVERLAP_CHARS,
} from "../rag/chunk-text.js";
import type { EmbeddingProvider } from "../rag/embedding-provider.js";
import { createJsonVectorIndex } from "../rag/json-vector-index.js";
import {
  createKnowledgeBase,
  type KnowledgeBase,
} from "../rag/knowledge-base.js";
import { createOllamaEmbeddingProvider } from "../rag/ollama-embedding-provider.js";
import type { KnowledgeDocument } from "../rag/rag-types.js";
import {
  VECTOR_INDEX_SCHEMA_VERSION,
  type VectorIndex,
} from "../rag/vector-index-types.js";
import {
  createVectorRetriever,
  type VectorRetriever,
} from "../rag/vector-retriever.js";
import type { MemoryStore } from "./memory-store.js";
import type { MemoryRecallResult } from "./memory-types.js";

const SEARCH_TOP_K = 5;
const DEFAULT_MIN_SCORE = 0.35;
const DEFAULT_MAX_RESULTS = 3;

export interface MemoryRecallService {
  recall(query: string): Promise<MemoryRecallResult>;
}

export interface CreateMemoryRecallServiceOptions {
  store: MemoryStore;
  embeddingProvider?: EmbeddingProvider;
  /** The memory index lifecycle owner when supplied, including with an injected retriever. */
  vectorIndex?: VectorIndex;
  vectorRetriever?: VectorRetriever;
  createVectorIndex?: typeof createJsonVectorIndex;
  storageConfig?: RagStorageConfig;
  createKnowledgeBase?: typeof createKnowledgeBase;
  minScore?: number;
  maxResults?: number;
  logger?: (message: string) => void;
}

interface MemoryVectorDependencies {
  vectorRetriever: VectorRetriever;
  memoryVectorIndex?: VectorIndex;
}

function resolveMemoryVectorDependencies(
  options: CreateMemoryRecallServiceOptions,
): MemoryVectorDependencies {
  if (options.vectorRetriever) {
    return {
      vectorRetriever: options.vectorRetriever,
      memoryVectorIndex: options.vectorIndex,
    };
  }

  const embeddingProvider = options.embeddingProvider
    ?? createOllamaEmbeddingProvider(loadEmbeddingConfig());
  const storageConfig = options.storageConfig ?? loadRagStorageConfig();
  const vectorIndex = options.vectorIndex
    ?? (options.createVectorIndex ?? createJsonVectorIndex)({
      filePath: join(storageConfig.dataDir, "memory-vector-index.json"),
      identity: {
        providerId: embeddingProvider.id,
        model: embeddingProvider.model,
        schemaVersion: VECTOR_INDEX_SCHEMA_VERSION,
      },
      chunkSizeChars: DEFAULT_CHUNK_SIZE_CHARS,
      overlapChars: DEFAULT_OVERLAP_CHARS,
      logger: options.logger,
    });

  return {
    vectorRetriever: createVectorRetriever(embeddingProvider, vectorIndex),
    memoryVectorIndex: vectorIndex,
  };
}

function memoryDocuments(
  memories: Awaited<ReturnType<MemoryStore["load"]>>["l2"],
): KnowledgeDocument[] {
  return memories.map((memory) => ({
    id: memory.id,
    title: memory.id,
    text: memory.content,
    source: "memory",
  }));
}

export function createMemoryRecallService(
  options: CreateMemoryRecallServiceOptions,
): MemoryRecallService {
  const { vectorRetriever, memoryVectorIndex } =
    resolveMemoryVectorDependencies(options);
  const createKnowledgeBaseFactory = options.createKnowledgeBase
    ?? createKnowledgeBase;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;

  return {
    async recall(query): Promise<MemoryRecallResult> {
      const memoryFile = await options.store.load();
      const l0 = structuredClone(memoryFile.l0);
      const l1 = structuredClone(memoryFile.l1);
      if (memoryFile.l2.length === 0) {
        if (memoryVectorIndex) {
          await memoryVectorIndex.initialize();
          await memoryVectorIndex.prune([]);
        }
        return { l0, l1, l2: [] };
      }

      const knowledgeBase: KnowledgeBase = createKnowledgeBaseFactory(
        memoryDocuments(memoryFile.l2),
        undefined,
        { vectorRetriever },
      );
      const response = await knowledgeBase.search(query, SEARCH_TOP_K);
      const memoriesById = new Map(
        memoryFile.l2.map((memory) => [memory.id, memory]),
      );
      const highestByMemoryId = new Map<
        string,
        MemoryRecallResult["l2"][number]
      >();

      for (const result of response.results) {
        if (result.score < minScore) continue;
        const memory = memoriesById.get(result.chunk.documentId);
        if (!memory) continue;
        const current = highestByMemoryId.get(memory.id);
        if (!current || result.score > current.score) {
          highestByMemoryId.set(memory.id, { memory, score: result.score });
        }
      }

      const recallResult: MemoryRecallResult = {
        l0,
        l1,
        l2: [...highestByMemoryId.values()]
          .sort(
            (left, right) => right.score - left.score
              || left.memory.id.localeCompare(right.memory.id),
          )
          .slice(0, maxResults),
        retrievalMode: response.mode,
      };
      if (response.warning !== undefined) {
        recallResult.warning = response.warning;
      }
      return recallResult;
    },
  };
}
