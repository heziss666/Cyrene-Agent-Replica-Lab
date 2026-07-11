export const VECTOR_INDEX_SCHEMA_VERSION = 1 as const;

export interface VectorIndexEntryKey {
  chunkId: string;
  textHash: string;
}

export interface VectorIndexEntry extends VectorIndexEntryKey {
  vector: number[];
}

export interface VectorIndexIdentity {
  providerId: string;
  model: string;
  schemaVersion: typeof VECTOR_INDEX_SCHEMA_VERSION;
}

export interface VectorIndexFile {
  schemaVersion: typeof VECTOR_INDEX_SCHEMA_VERSION;
  embedding: {
    providerId: string;
    model: string;
    dimensions: number;
  };
  chunking: {
    chunkSizeChars: number;
    overlapChars: number;
  };
  entries: VectorIndexEntry[];
}

export type VectorIndexLoadStatus =
  | "missing"
  | "loaded"
  | "incompatible"
  | "corrupt";

export interface VectorIndexLoadResult {
  status: VectorIndexLoadStatus;
  loadedEntries: number;
  warning?: string;
}

export interface VectorIndex {
  initialize(): Promise<VectorIndexLoadResult>;
  has(chunkId: string, textHash: string): boolean;
  get(chunkId: string, textHash: string): number[] | undefined;
  addMany(entries: VectorIndexEntry[]): Promise<void>;
  prune(validEntries: VectorIndexEntryKey[]): Promise<number>;
  clear(): Promise<void>;
}
