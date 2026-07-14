export interface L0Profile {
  preferredName?: string;
  occupation?: string;
  longTermInterests: string[];
  language?: string;
  permanentNotes: string[];
  updatedAt?: string;
  fieldMetadata?: Partial<Record<L0Field, ProfileFieldMetadata>>;
}

export interface L1Profile {
  currentProject?: string;
  recentGoals: string[];
  recentPreferences: string[];
  updatedAt?: string;
  fieldMetadata?: Partial<Record<L1Field, ProfileFieldMetadata>>;
}

export interface ProfileFieldMetadata {
  updatedAt: string;
  source: "judge" | "reflection" | "user_edit" | "resolver";
  confidence?: number;
}

export interface L2MemoryV1 {
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

export type L2Memory = L2MemoryV1;

export interface MemoryFileV1 {
  schemaVersion: 1;
  l0: L0Profile;
  l1: L1Profile;
  l2: L2MemoryV1[];
}

export type MemoryFile = MemoryFileV1;

export type L2MemoryStatus = "active" | "aging" | "archived" | "superseded" | "merged";

export type L2SyncStatus = "pending_sync" | "synced" | "sync_failed";

export type L2Importance = "medium" | "high";

export interface MemorySourceSnapshot {
  memoryId: string;
  updatedAt: string;
}

export interface L2MemoryV2 {
  id: string;
  content: string;
  confidence: number;
  importance: L2Importance;
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  accessCount: number;
  weight: number;
  isPinned: boolean;
  isEnabled: boolean;
  status: L2MemoryStatus;
  syncStatus: L2SyncStatus;
  isSummary: boolean;
  sourceMemoryIds: string[];
  sourceSnapshots: MemorySourceSnapshot[];
  conflictWith: string[];
  supersededBy?: string;
  mergedInto?: string;
}

export interface MemoryEvidence {
  id: string;
  memoryId: string;
  quote: string;
  capturedAt: string;
  source: "conversation" | "user_edit" | "reflection" | "resolver";
  sourceMemoryIds: string[];
}

export interface ConflictSignals {
  score?: number;
  semanticSimilarity?: number;
  contradictionScore?: number;
  entityOverlap?: number;
  temporalOverlap?: number;
}

export type ConflictStatus = "queued" | "processing" | "resolved" | "uncertain" | "failed";

export type ConflictPriority = "idle" | "normal" | "high";

export type ConflictResolutionType =
  | "unrelated"
  | "context_difference"
  | "preference_evolution"
  | "direct_conflict"
  | "uncertain";

export interface ConflictLog {
  id: string;
  sourceMemoryId: string;
  targetMemoryId: string;
  createdAt: string;
  status: ConflictStatus;
  score: number;
  priority: ConflictPriority;
  attempts: number;
  signals: ConflictSignals;
  resolutionType?: ConflictResolutionType;
  resolutionReason?: string;
  resolutionConfidence?: number;
  finishedAt?: string;
}

export interface ReflectionLog {
  id: string;
  createdAt: string;
  type: "compression" | "l0_update" | "l1_update" | "lifecycle";
  sourceMemoryIds: string[];
  acceptedCount: number;
  skippedCount: number;
}

export interface MemoryAuditEntry {
  id: string;
  createdAt: string;
  operation: string;
  targetType: string;
  targetId?: string;
  field?: string;
  source: "automatic" | "user" | "system";
  result: "success" | "skipped" | "failed";
  code?: string;
}

export interface MemoryMaintenanceState {
  lastDecayAt?: string;
  lastMaintenanceAt?: string;
  lastReflectionAt?: string;
  lastCompressionAt?: string;
  lastEntityGraphAt?: string;
  successfulWritesSinceMaintenance: number;
  running: boolean;
  lastErrorCode?: string;
}

export interface MemoryFileV2 {
  schemaVersion: 2;
  l0: L0Profile;
  l1: L1Profile;
  l2: L2MemoryV2[];
  evidence: MemoryEvidence[];
  conflictLogs: ConflictLog[];
  reflectionLogs: ReflectionLog[];
  auditLogs: MemoryAuditEntry[];
  maintenance: MemoryMaintenanceState;
}

export function createEmptyMemoryFileV2(): MemoryFileV2 {
  return {
    schemaVersion: 2,
    l0: {
      longTermInterests: [],
      permanentNotes: [],
      fieldMetadata: {},
    },
    l1: {
      recentGoals: [],
      recentPreferences: [],
      fieldMetadata: {},
    },
    l2: [],
    evidence: [],
    conflictLogs: [],
    reflectionLogs: [],
    auditLogs: [],
    maintenance: {
      successfulWritesSinceMaintenance: 0,
      running: false,
    },
  };
}

export function initialMemoryWeight(
  importance: L2Importance,
  confidence: number,
  isSummary = false,
): number {
  const base = importance === "high" ? 0.85 : 0.6;
  const weightedConfidence = Number.isFinite(confidence) ? base * confidence : 0;
  const weight = isSummary ? Math.max(0.75, weightedConfidence) : weightedConfidence;
  return Math.min(1, Math.max(0, weight));
}

export function isRecallableL2(memory: L2MemoryV2): boolean {
  return (
    memory.isEnabled &&
    (memory.status === "active" || memory.status === "aging") &&
    (!memory.isSummary || memory.syncStatus === "synced")
  );
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
