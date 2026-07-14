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

export type UpdateProfileResult = MemoryMutationResult;

export interface UpdateL2Input {
  id: string;
  content: string;
}

export type UpdateL2Result = MemoryMutationResult;

export type DeleteProfileFieldInput =
  | { layer: "L0"; field: L0Field }
  | { layer: "L1"; field: L1Field };

export type DeleteFieldInput = DeleteProfileFieldInput;

export type DeleteFieldResult = MemoryMutationResult;

export interface SetPinnedInput {
  id: string;
  pinned: boolean;
}

export type PinMemoryResult = MemoryMutationResult;

export interface SetEnabledInput {
  id: string;
  enabled: boolean;
}

export type EnableMemoryResult = MemoryMutationResult;

export interface ClearLayerInput {
  layer: MemoryLayer;
}

export type ClearLayerResult = MemoryMutationResult;

export interface MaintenanceResult {
  success: boolean;
  maintenance: MemoryMaintenanceSnapshot;
  code?: string;
}

export type MemoryMutationErrorCode =
  | "not_found"
  | "invalid_state"
  | "invalid_content";

export type MemoryMutationResult =
  | { ok: true; snapshot: MemorySnapshot }
  | {
    ok: false;
    code: MemoryMutationErrorCode;
    message: string;
  };

export type MemoryAuditFindingCode =
  | "missing_evidence"
  | "broken_superseded_by"
  | "broken_merged_into"
  | "active_conflict_without_live_log"
  | "summary_source_missing"
  | "source_snapshot_missing"
  | "source_snapshot_mismatch";

export interface MemoryAuditFinding {
  code: MemoryAuditFindingCode;
  severity: "warning" | "error";
  targetId: string;
  relatedId?: string;
}

export interface MemoryAuditReport {
  ok: boolean;
  findings: MemoryAuditFinding[];
}

export interface MemoryApi {
  getSnapshot(): Promise<MemorySnapshot>;
  updateProfileField(input: UpdateProfileFieldInput): Promise<MemoryMutationResult>;
  updateL2(input: UpdateL2Input): Promise<MemoryMutationResult>;
  deleteProfileField(input: DeleteProfileFieldInput): Promise<MemoryMutationResult>;
  deleteL2(id: string): Promise<MemoryMutationResult>;
  setL2Pinned(input: SetPinnedInput): Promise<MemoryMutationResult>;
  setL2Enabled(input: SetEnabledInput): Promise<MemoryMutationResult>;
  restoreL2(id: string): Promise<MemoryMutationResult>;
  clearLayer(layer: MemoryLayer): Promise<MemoryMutationResult>;
  getAuditReport(): Promise<MemoryAuditReport>;
}

export type MemoryUpdateProfileInput = UpdateProfileInput;
export type MemoryUpdateProfileResult = UpdateProfileResult;
export type MemoryUpdateL2Input = UpdateL2Input;
export type MemoryUpdateL2Result = UpdateL2Result;
export type MemoryDeleteFieldInput = DeleteFieldInput;
export type MemoryDeleteFieldResult = DeleteFieldResult;
export type PinMemoryInput = SetPinnedInput;
export type MemoryPinInput = SetPinnedInput;
export type MemoryPinResult = PinMemoryResult;
export type EnableMemoryInput = SetEnabledInput;
export type MemoryEnableInput = SetEnabledInput;
export type MemoryEnableResult = EnableMemoryResult;
export type MemoryClearLayerInput = ClearLayerInput;
export type MemoryClearLayerResult = ClearLayerResult;
export type MemoryMaintenanceResult = MaintenanceResult;
export type MemoryFieldMetadata = ProfileFieldMetadata;
