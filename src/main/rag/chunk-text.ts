import type { KnowledgeChunk, KnowledgeDocument } from "./rag-types.js";

export interface ChunkDocumentOptions {
  chunkSizeChars?: number;
  overlapChars?: number;
}

export const DEFAULT_CHUNK_SIZE_CHARS = 600;
export const DEFAULT_OVERLAP_CHARS = 120;

export function chunkDocument(
  document: KnowledgeDocument,
  options: ChunkDocumentOptions = {},
): KnowledgeChunk[] {
  const chunkSizeChars = options.chunkSizeChars ?? DEFAULT_CHUNK_SIZE_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  if (chunkSizeChars <= 0) {
    throw new Error("chunkSizeChars must be greater than 0");
  }

  if (overlapChars < 0) {
    throw new Error("overlapChars must be greater than or equal to 0");
  }

  if (overlapChars >= chunkSizeChars) {
    throw new Error("overlapChars must be smaller than chunkSizeChars");
  }

  const text = document.text.trim();
  if (!text) {
    return [];
  }

  const chunks: KnowledgeChunk[] = [];
  const step = chunkSizeChars - overlapChars;

  for (let start = 0, index = 0; start < text.length; start += step, index += 1) {
    const end = Math.min(start + chunkSizeChars, text.length);
    const chunkText = text.slice(start, end).trim();

    if (chunkText) {
      chunks.push({
        id: `${document.id}_chunk_${index}`,
        documentId: document.id,
        title: document.title,
        text: chunkText,
        source: document.source,
        index,
        metadata: document.metadata,
      });
    }

    if (end >= text.length) {
      break;
    }
  }

  return chunks;
}
