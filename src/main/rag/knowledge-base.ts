import { searchChunksByKeyword } from "./keyword-retriever.js";
import {
  createInMemoryKnowledgeStore,
  type KnowledgeStore,
} from "./knowledge-store.js";
import type {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeSearchResponse,
} from "./rag-types.js";
import type { VectorRetriever } from "./vector-retriever.js";

export interface AddKnowledgeDocumentInput {
  id?: string;
  title: string;
  text: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateKnowledgeBaseOptions {
  vectorRetriever?: VectorRetriever;
}

export interface KnowledgeBase {
  addDocument(input: AddKnowledgeDocumentInput): KnowledgeChunk[];
  search(query: string, topK?: number): Promise<KnowledgeSearchResponse>;
  clear(): void;
}

export function createKnowledgeBase(
  initialDocuments: KnowledgeDocument[] = [],
  store: KnowledgeStore = createInMemoryKnowledgeStore(),
  options: CreateKnowledgeBaseOptions = {},
): KnowledgeBase {
  let nextDocumentNumber = 1;

  function addDocument(input: AddKnowledgeDocumentInput): KnowledgeChunk[] {
    const id = input.id ?? `doc_${nextDocumentNumber}`;
    if (!input.id) nextDocumentNumber += 1;

    return store.addDocument({
      id,
      title: input.title,
      text: input.text,
      source: input.source ?? "local",
      metadata: input.metadata,
    });
  }

  for (const document of initialDocuments) addDocument(document);

  return {
    addDocument,

    async search(query, topK = 5) {
      const chunks = store.getChunks();
      if (options.vectorRetriever) {
        try {
          return {
            mode: "vector",
            model: options.vectorRetriever.model,
            results: await options.vectorRetriever.retrieve(query, chunks, topK),
          };
        } catch (error) {
          return {
            mode: "keyword-fallback",
            results: searchChunksByKeyword(query, chunks, { topK }),
            warning: error instanceof Error ? error.message : String(error),
          };
        }
      }

      return {
        mode: "keyword-fallback",
        results: searchChunksByKeyword(query, chunks, { topK }),
        warning: "Vector retriever is not configured",
      };
    },

    clear() {
      store.clear();
      options.vectorRetriever?.clear();
    },
  };
}
