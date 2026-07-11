export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;

  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(query: string): Promise<number[]>;
}
