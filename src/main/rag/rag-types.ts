export interface KnowledgeDocument {
  id: string;
  title: string;
  text: string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  title: string;
  text: string;
  source: string;
  index: number;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeSearchResult {
  chunk: KnowledgeChunk;
  score: number;
  matchedTerms?: string[];
}

export interface KnowledgeSearchResponse {
  mode: "vector" | "keyword-fallback";
  model?: string;
  results: KnowledgeSearchResult[];
  warning?: string;
}
