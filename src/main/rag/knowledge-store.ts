import { chunkDocument } from "./chunk-text.js";
import type { KnowledgeChunk, KnowledgeDocument } from "./rag-types.js";

export interface KnowledgeStore {
  addDocument(document: KnowledgeDocument): KnowledgeChunk[];
  getChunks(): KnowledgeChunk[];
  clear(): void;
}

function cloneChunk(chunk: KnowledgeChunk): KnowledgeChunk {
  return {
    ...chunk,
    metadata: chunk.metadata ? { ...chunk.metadata } : undefined,
  };
}

export function createInMemoryKnowledgeStore(): KnowledgeStore {
  let chunks: KnowledgeChunk[] = [];

  return {
    addDocument(document) {
      const nextChunks = chunkDocument(document);
      chunks = chunks.concat(nextChunks);
      return nextChunks.map(cloneChunk);
    },

    getChunks() {
      return chunks.map(cloneChunk);
    },

    clear() {
      chunks = [];
    },
  };
}
