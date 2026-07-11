import type { KnowledgeChunk, KnowledgeSearchResult } from "./rag-types.js";

export interface KeywordSearchOptions {
  topK?: number;
}

const DEFAULT_TOP_K = 5;
const TERM_ALIASES: Record<string, string[]> = {
  工具: ["tool", "tools"],
  tool: ["tools", "工具"],
  tools: ["tool", "工具"],
};

export function extractSearchTerms(query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  return Array.from(normalized.matchAll(/[a-z0-9]+|[\u4e00-\u9fff]+/g))
    .map((match) => match[0])
    .filter((term, index, terms) => term.length > 0 && terms.indexOf(term) === index);
}

function countOccurrences(text: string, term: string): number {
  if (!text || !term) {
    return 0;
  }

  let count = 0;
  let position = 0;

  while (position < text.length) {
    const next = text.indexOf(term, position);
    if (next === -1) {
      break;
    }
    count += 1;
    position = next + term.length;
  }

  return count;
}

function expandTerm(term: string): string[] {
  return [term, ...(TERM_ALIASES[term] ?? [])];
}

export function searchChunksByKeyword(
  query: string,
  chunks: KnowledgeChunk[],
  options: KeywordSearchOptions = {},
): KnowledgeSearchResult[] {
  const terms = extractSearchTerms(query);
  if (terms.length === 0) {
    return [];
  }

  const topK = options.topK ?? DEFAULT_TOP_K;
  const scored = chunks
    .map((chunk) => {
      const title = chunk.title.toLowerCase();
      const text = chunk.text.toLowerCase();
      const matchedTerms: string[] = [];
      let score = 0;

      for (const term of terms) {
        const variants = expandTerm(term);
        const titleMatches = variants.reduce((sum, variant) => sum + countOccurrences(title, variant), 0);
        const bodyMatches = variants.reduce((sum, variant) => sum + countOccurrences(text, variant), 0);
        const termScore = titleMatches * 3 + bodyMatches;

        if (termScore > 0) {
          matchedTerms.push(term);
          score += termScore;
        }
      }

      return { chunk, score, matchedTerms };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.chunk.id.localeCompare(b.chunk.id);
    });

  return scored.slice(0, topK);
}
