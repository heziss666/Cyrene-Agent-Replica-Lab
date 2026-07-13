export interface L0Profile {
  preferredName?: string;
  occupation?: string;
  longTermInterests: string[];
  language?: string;
  permanentNotes: string[];
  updatedAt?: string;
}

export interface L1Profile {
  currentProject?: string;
  recentGoals: string[];
  recentPreferences: string[];
  updatedAt?: string;
}

export interface L2Memory {
  id: string;
  content: string;
  confidence: number;
  importance: "medium" | "high";
  evidence: {
    userQuote: string;
    capturedAt: string;
  };
  createdAt: string;
  status: "active";
}

export interface MemoryFile {
  schemaVersion: 1;
  l0: L0Profile;
  l1: L1Profile;
  l2: L2Memory[];
}

export interface MemoryCandidate {
  layer: "L0" | "L1" | "L2";
  field?: string;
  content: string;
  confidence: number;
  importance: "low" | "medium" | "high";
  evidenceQuote: string;
  reason: string;
}

export type L0Field =
  | "preferredName"
  | "occupation"
  | "longTermInterests"
  | "language"
  | "permanentNotes";

export type L1Field =
  | "currentProject"
  | "recentGoals"
  | "recentPreferences";

export interface MemoryWriteSummary {
  candidateCount: number;
  writtenCount: number;
  skippedCount: number;
  writes: string[];
}

export interface MemoryRecallResult {
  l0: L0Profile;
  l1: L1Profile;
  l2: Array<{ memory: L2Memory; score: number }>;
  retrievalMode?: "vector" | "keyword-fallback";
  warning?: string;
}
