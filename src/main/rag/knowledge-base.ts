import { searchChunksByKeyword } from "./keyword-retriever.js";
import { createInMemoryKnowledgeStore, type KnowledgeStore } from "./knowledge-store.js";
import type { KnowledgeChunk, KnowledgeDocument, KnowledgeSearchResult } from "./rag-types.js";

export interface AddKnowledgeDocumentInput {
  id?: string;
  title: string;
  text: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeBase {
  addDocument(input: AddKnowledgeDocumentInput): KnowledgeChunk[];
  search(query: string, topK?: number): KnowledgeSearchResult[];
  clear(): void;
}

export function createKnowledgeBase(
  initialDocuments: KnowledgeDocument[] = [],
  store: KnowledgeStore = createInMemoryKnowledgeStore(),
): KnowledgeBase {
  let nextDocumentNumber = 1;

  function addDocument(input: AddKnowledgeDocumentInput): KnowledgeChunk[] {
    const id = input.id ?? `doc_${nextDocumentNumber}`;
    if (!input.id) {
      nextDocumentNumber += 1;
    }

    return store.addDocument({
      id,
      title: input.title,
      text: input.text,
      source: input.source ?? "local",
      metadata: input.metadata,
    });
  }

  for (const document of initialDocuments) {
    addDocument(document);
  }

  return {
    addDocument,

    search(query, topK = 5) {
      return searchChunksByKeyword(query, store.getChunks(), { topK });
    },

    clear() {
      store.clear();
    },
  };
}
