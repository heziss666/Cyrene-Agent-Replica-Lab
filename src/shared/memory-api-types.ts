import type {
  ConflictPriority,
  ConflictStatus,
  ConflictResolutionType,
  L0Field,
  L1Field,
  L2Importance,
  L2MemoryStatus,
  L2SyncStatus,
  MemoryAuditEntry,
  MemoryMaintenanceState,
  ProfileFieldMetadata,
  ReflectionLog,
} from "../main/memory/memory-types.js";

export type MemoryLayer = "L0" | "L1" | "L2";

export type MemoryProfileLayer = "L0" | "L1";

export interface MemoryL0Snapshot {
  preferredName?: string;
  occupation?: string;
  longTermInterests: string[];
  language?: string;
  permanentNotes: string[];
  updatedAt?: string;
  fieldMetadata?: Partial<Record<L0Field, ProfileFieldMetadata>>;
}

export interface MemoryL1Snapshot {
  currentProject?: string;
  recentGoals: string[];
  recentPreferences: string[];
  updatedAt?: string;
  fieldMetadata?: Partial<Record<L1Field, ProfileFieldMetadata>>;
}

export type MemoryProfileSnapshot = MemoryL0Snapshot | MemoryL1Snapshot;

export interface MemoryL2Row {
  id: string;
  content: string;
  confidence: number;
  importance: L2Importance;
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
  evidenceCount: number;
  sourceMemoryIds: string[];
  conflictWith: string[];
  supersededBy?: string;
  mergedInto?: string;
}

export interface MemoryConflictRow {
  id: string;
  sourceMemoryId: string;
  targetMemoryId: string;
  createdAt: string;
  status: ConflictStatus;
  score: number;
  priority: ConflictPriority;
  attempts: number;
  resolutionType?: ConflictResolutionType;
  resolutionReason?: string;
  resolutionConfidence?: number;
  finishedAt?: string;
}

export interface MemoryReflectionRow {
  id: ReflectionLog["id"];
  createdAt: ReflectionLog["createdAt"];
  type: ReflectionLog["type"];
  sourceMemoryIds: string[];
  acceptedCount: number;
  skippedCount: number;
}

export type MemoryAuditMetadata = Pick<
  MemoryAuditEntry,
  "id" | "createdAt" | "operation" | "targetType" | "targetId" | "field" | "source" | "result" | "code"
>;

export type MemoryMaintenanceSnapshot = MemoryMaintenanceState;

export interface MemorySnapshot {
  l0: MemoryL0Snapshot;
  l1: MemoryL1Snapshot;
  l2: MemoryL2Row[];
  conflicts: MemoryConflictRow[];
  reflections: MemoryReflectionRow[];
  audit: MemoryAuditMetadata[];
  maintenance: MemoryMaintenanceSnapshot;
}

export type UpdateProfileFieldInput =
  | { layer: "L0"; field: L0Field; value: string | string[] }
  | { layer: "L1"; field: L1Field; value: string | string[] };

export type UpdateProfileInput = UpdateProfileFieldInput;

export interface UpdateProfileResult {
  success: boolean;
  layer: MemoryProfileLayer;
  field: string;
  updatedAt?: string;
  code?: string;
}

export interface UpdateL2Input {
  id: string;
  content?: string;
  confidence?: number;
  importance?: L2Importance;
  isSummary?: boolean;
  sourceMemoryIds?: string[];
}

export interface UpdateL2Result {
  success: boolean;
  id: string;
  updatedAt?: string;
  code?: string;
}

export type DeleteProfileFieldInput =
  | { layer: "L0"; field: L0Field }
  | { layer: "L1"; field: L1Field };

export type DeleteFieldInput = DeleteProfileFieldInput;

export interface DeleteFieldResult {
  success: boolean;
  layer: MemoryProfileLayer;
  field: string;
  code?: string;
}

export interface PinMemoryInput {
  id: string;
  isPinned: boolean;
}

export interface PinMemoryResult {
  success: boolean;
  id: string;
  isPinned: boolean;
  code?: string;
}

export interface EnableMemoryInput {
  id: string;
  isEnabled: boolean;
}

export interface EnableMemoryResult {
  success: boolean;
  id: string;
  isEnabled: boolean;
  code?: string;
}

export interface ClearLayerInput {
  layer: MemoryLayer;
}

export interface ClearLayerResult {
  success: boolean;
  layer: MemoryLayer;
  clearedCount?: number;
  code?: string;
}

export interface MaintenanceResult {
  success: boolean;
  maintenance: MemoryMaintenanceSnapshot;
  code?: string;
}

export interface AuditReport {
  entries: MemoryAuditMetadata[];
  total: number;
  successCount: number;
  skippedCount: number;
  failedCount: number;
}

export type MemoryUpdateProfileInput = UpdateProfileInput;
export type MemoryUpdateProfileResult = UpdateProfileResult;
export type MemoryUpdateL2Input = UpdateL2Input;
export type MemoryUpdateL2Result = UpdateL2Result;
export type MemoryDeleteFieldInput = DeleteFieldInput;
export type MemoryDeleteFieldResult = DeleteFieldResult;
export type MemoryPinInput = PinMemoryInput;
export type MemoryPinResult = PinMemoryResult;
export type MemoryEnableInput = EnableMemoryInput;
export type MemoryEnableResult = EnableMemoryResult;
export type MemoryClearLayerInput = ClearLayerInput;
export type MemoryClearLayerResult = ClearLayerResult;
export type MemoryMaintenanceResult = MaintenanceResult;
export type MemoryAuditReport = AuditReport;

export type MemoryFieldMetadata = ProfileFieldMetadata;
