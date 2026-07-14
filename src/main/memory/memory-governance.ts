import { randomUUID } from "node:crypto";
import type {
  DeleteProfileFieldInput,
  MemoryAuditReport,
  MemoryConflictRow,
  MemoryL2Row,
  MemoryMutationErrorCode,
  MemoryMutationResult,
  MemoryReflectionRow,
  MemorySnapshot,
  SetEnabledInput,
  SetPinnedInput,
  UpdateL2Input,
  UpdateProfileFieldInput,
} from "../../shared/memory-api-types.js";
import { auditMemoryFile } from "./memory-audit.js";
import { validateUserEditedMemoryContent } from "./memory-content-policy.js";
import type { MemoryStore } from "./memory-store.js";
import type {
  ConflictLog,
  L0Field,
  L0Profile,
  L1Field,
  L1Profile,
  L2MemoryV2,
  MemoryAuditEntry,
  MemoryFile,
} from "./memory-types.js";

export const MEMORY_AUDIT_LOG_LIMIT = 500;

const L0_STRING_FIELDS = new Set<L0Field>([
  "preferredName",
  "occupation",
  "language",
]);
const L0_ARRAY_FIELDS = new Set<L0Field>([
  "longTermInterests",
  "permanentNotes",
]);
const L1_STRING_FIELDS = new Set<L1Field>(["currentProject"]);
const L1_ARRAY_FIELDS = new Set<L1Field>([
  "recentGoals",
  "recentPreferences",
]);
const EXECUTABLE_CONFLICT_STATUSES = new Set<ConflictLog["status"]>([
  "queued",
  "processing",
  "uncertain",
]);

interface CreateMemoryGovernanceServiceOptions {
  store: MemoryStore;
  now?: () => number;
  idFactory?: () => string;
  snapshotBuilder?: (memory: MemoryFile) => MemorySnapshot;
}

interface MutationAuditMetadata {
  operation: string;
  targetType: string;
  targetId?: string;
  field?: string;
}

type ProfileValue = string | string[];
type StoreMutation = (
  draft: MemoryFile,
  timestamp: string,
) => MutationAuditMetadata;
type L2Mutation = (
  memory: L2MemoryV2,
  draft: MemoryFile,
  timestamp: string,
) => void;

const STORE_FAILURE_MESSAGE = "Memory operation could not be completed";
const READ_FAILURE_MESSAGE = "Memory data could not be loaded";

export interface MemoryGovernanceService {
  snapshot(): Promise<MemorySnapshot>;
  updateProfileField(input: UpdateProfileFieldInput): Promise<MemoryMutationResult>;
  updateL2(input: UpdateL2Input): Promise<MemoryMutationResult>;
  deleteProfileField(input: DeleteProfileFieldInput): Promise<MemoryMutationResult>;
  deleteL2(id: string): Promise<MemoryMutationResult>;
  setL2Pinned(input: SetPinnedInput): Promise<MemoryMutationResult>;
  setL2Enabled(input: SetEnabledInput): Promise<MemoryMutationResult>;
  restoreL2(id: string): Promise<MemoryMutationResult>;
  clearLayer(layer: "L0" | "L1" | "L2"): Promise<MemoryMutationResult>;
  audit(): Promise<MemoryAuditReport>;
}

class MutationRejected extends Error {
  constructor(
    readonly code: MemoryMutationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MutationRejected";
  }
}

export function createMemoryGovernanceService(
  options: CreateMemoryGovernanceServiceOptions,
): MemoryGovernanceService {
  const { store } = options;
  const now = options.now ?? Date.now;
  const idFactory = options.idFactory ?? randomUUID;
  const snapshotBuilder = options.snapshotBuilder ?? toMemorySnapshot;

  async function commitMutation(mutate: StoreMutation): Promise<MemoryMutationResult> {
    let snapshot: MemorySnapshot | undefined;

    try {
      await store.update((draft) => {
        const timestamp = new Date(now()).toISOString();
        const audit = mutate(draft, timestamp);
        appendSuccessAudit(draft, timestamp, idFactory, audit);
        snapshot = snapshotBuilder(draft);
      });
      if (snapshot === undefined) return failure("invalid_state", STORE_FAILURE_MESSAGE);
      return { ok: true, snapshot };
    } catch (error) {
      if (error instanceof MutationRejected) return failure(error.code, error.message);
      return failure("invalid_state", STORE_FAILURE_MESSAGE);
    }
  }

  async function commitL2Mutation(
    id: string,
    operation: string,
    mutate: L2Mutation,
  ): Promise<MemoryMutationResult> {
    return commitMutation((draft, timestamp) => {
      const memory = requireMemory(draft, id);
      mutate(memory, draft, timestamp);
      return {
        operation,
        targetType: "L2",
        targetId: id,
      };
    });
  }

  return {
    async snapshot(): Promise<MemorySnapshot> {
      try {
        return snapshotBuilder(await store.load());
      } catch {
        throw new Error(READ_FAILURE_MESSAGE);
      }
    },

    async updateProfileField(input): Promise<MemoryMutationResult> {
      const parsed = validateProfileUpdate(input);
      if (!parsed.ok) return parsed.result;

      return commitMutation((draft, timestamp) => {
        const target = profileForLayer(draft, input.layer) as L0Profile & L1Profile;
        const currentValue = target[input.field as keyof typeof target];
        if (profileValuesEqual(currentValue, parsed.value)) {
          throw new MutationRejected(
            "invalid_state",
            "Memory field already has that value",
          );
        }
        (target as unknown as Record<string, unknown>)[input.field] = structuredClone(parsed.value);
        target.updatedAt = timestamp;
        target.fieldMetadata ??= {};
        (target.fieldMetadata as Record<string, unknown>)[input.field] = {
          updatedAt: timestamp,
          source: "user_edit",
        };
        return {
          operation: "update_profile_field",
          targetType: input.layer,
          targetId: input.layer,
          field: input.field,
        };
      });
    },

    async updateL2(input): Promise<MemoryMutationResult> {
      if (!isRecord(input) || !isNonEmptyString(input.id) || typeof input.content !== "string") {
        return failure("invalid_content", "Memory update payload is invalid");
      }
      const contentResult = validateUserEditedMemoryContent(input.content);
      if (!contentResult.ok) return contentFailure(contentResult.code);

      return commitL2Mutation(input.id, "update_l2", (current, draft, timestamp) => {
          if (current.content === contentResult.content) {
            throw new MutationRejected(
              "invalid_state",
              "Memory already has that content",
            );
          }
          const removedEvidenceIds = collectOwnedEvidenceIds(draft, current);
          draft.evidence = draft.evidence.filter((evidence) => (
            evidence.memoryId !== current.id && !removedEvidenceIds.has(evidence.id)
          ));
          for (const item of draft.l2) {
            if (item.id !== current.id) {
              item.evidenceIds = item.evidenceIds.filter((id) => !removedEvidenceIds.has(id));
            }
          }

          const evidenceId = idFactory();
          current.content = contentResult.content;
          current.updatedAt = timestamp;
          current.syncStatus = "pending_sync";
          current.evidenceIds = [evidenceId];
          draft.evidence.push({
            id: evidenceId,
            memoryId: current.id,
            quote: contentResult.content,
            capturedAt: timestamp,
            source: "user_edit",
            sourceMemoryIds: [],
          });
      });
    },

    async deleteProfileField(input): Promise<MemoryMutationResult> {
      if (!isValidProfileField(input)) {
        return failure("invalid_content", "Memory field payload is invalid");
      }
      return commitMutation((draft, timestamp) => {
        const target = profileForLayer(draft, input.layer) as L0Profile & L1Profile;
        if (!profileFieldHasValue(target, input.field)) {
          throw new MutationRejected("not_found", "Memory field was not found");
        }
        if (isArrayProfileField(input.layer, input.field)) {
          (target as unknown as Record<string, unknown>)[input.field] = [];
        } else {
          delete (target as unknown as Record<string, unknown>)[input.field];
        }
        target.updatedAt = timestamp;
        if (target.fieldMetadata) {
          delete (target.fieldMetadata as Record<string, unknown>)[input.field];
        }
        return {
          operation: "delete_profile_field",
          targetType: input.layer,
          targetId: input.layer,
          field: input.field,
        };
      });
    },

    async deleteL2(id): Promise<MemoryMutationResult> {
      if (!isNonEmptyString(id)) return failure("invalid_content", "Memory ID is invalid");
      return commitL2Mutation(id, "delete_l2", (_memory, draft, timestamp) => {
        deleteMemoryCascade(draft, id, timestamp);
      });
    },

    async setL2Pinned(input): Promise<MemoryMutationResult> {
      if (!isRecord(input) || !isNonEmptyString(input.id) || typeof input.pinned !== "boolean") {
        return failure("invalid_content", "Pin payload is invalid");
      }
      return commitL2Mutation(input.id, "set_l2_pinned", (current) => {
        if (current.isPinned === input.pinned) {
          throw new MutationRejected(
            "invalid_state",
            "Memory already has that pin state",
          );
        }
        current.isPinned = input.pinned;
        if (input.pinned) current.weight = 1;
      });
    },

    async setL2Enabled(input): Promise<MemoryMutationResult> {
      if (!isRecord(input) || !isNonEmptyString(input.id) || typeof input.enabled !== "boolean") {
        return failure("invalid_content", "Enable payload is invalid");
      }
      return commitL2Mutation(input.id, "set_l2_enabled", (current) => {
        if (current.isEnabled === input.enabled) {
          throw new MutationRejected(
            "invalid_state",
            "Memory already has that enabled state",
          );
        }
        current.isEnabled = input.enabled;
      });
    },

    async restoreL2(id): Promise<MemoryMutationResult> {
      if (!isNonEmptyString(id)) return failure("invalid_content", "Memory ID is invalid");
      return commitL2Mutation(id, "restore_l2", (memory, draft, timestamp) => {
        if (!(["archived", "superseded", "merged"] as const).includes(
          memory.status as "archived" | "superseded" | "merged",
        )) {
          throw new MutationRejected("invalid_state", "Memory is not restorable");
        }
        restoreMemory(draft, id, timestamp);
      });
    },

    async clearLayer(layer): Promise<MemoryMutationResult> {
      if (layer !== "L0" && layer !== "L1" && layer !== "L2") {
        return failure("invalid_content", "Memory layer is invalid");
      }
      return commitMutation((draft, timestamp) => {
        if (!layerNeedsCleanup(draft, layer)) {
          throw new MutationRejected("invalid_state", "Memory layer is already empty");
        }
        clearMemoryLayer(draft, layer, timestamp);
        return {
          operation: "clear_layer",
          targetType: layer,
          targetId: layer,
        };
      });
    },

    async audit(): Promise<MemoryAuditReport> {
      try {
        return auditMemoryFile(await store.load());
      } catch {
        throw new Error(READ_FAILURE_MESSAGE);
      }
    },
  };
}

export function toMemorySnapshot(memory: MemoryFile): MemorySnapshot {
  return {
    l0: structuredClone(memory.l0),
    l1: structuredClone(memory.l1),
    l2: memory.l2.map(toL2Row),
    conflicts: memory.conflictLogs.map(toConflictRow),
    reflections: memory.reflectionLogs.map(toReflectionRow),
    audit: memory.auditLogs.map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      operation: entry.operation,
      targetType: entry.targetType,
      ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
      ...(entry.field === undefined ? {} : { field: entry.field }),
      source: entry.source,
      result: entry.result,
      ...(entry.code === undefined ? {} : { code: entry.code }),
    })),
    maintenance: structuredClone(memory.maintenance),
  };
}

function toL2Row(memory: L2MemoryV2): MemoryL2Row {
  return {
    id: memory.id,
    content: memory.content,
    confidence: memory.confidence,
    importance: memory.importance,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    lastAccessedAt: memory.lastAccessedAt,
    accessCount: memory.accessCount,
    weight: memory.weight,
    isPinned: memory.isPinned,
    isEnabled: memory.isEnabled,
    status: memory.status,
    syncStatus: memory.syncStatus,
    isSummary: memory.isSummary,
    evidenceCount: memory.evidenceIds.length,
    sourceMemoryIds: structuredClone(memory.sourceMemoryIds),
    conflictWith: structuredClone(memory.conflictWith),
    ...(memory.supersededBy === undefined ? {} : { supersededBy: memory.supersededBy }),
    ...(memory.mergedInto === undefined ? {} : { mergedInto: memory.mergedInto }),
  };
}

function toConflictRow(conflict: ConflictLog): MemoryConflictRow {
  return {
    id: conflict.id,
    sourceMemoryId: conflict.sourceMemoryId,
    targetMemoryId: conflict.targetMemoryId,
    createdAt: conflict.createdAt,
    status: conflict.status,
    score: conflict.score,
    priority: conflict.priority,
    attempts: conflict.attempts,
    ...(conflict.resolutionType === undefined
      ? {}
      : { resolutionType: conflict.resolutionType }),
    ...(conflict.resolutionConfidence === undefined
      ? {}
      : { resolutionConfidence: conflict.resolutionConfidence }),
    ...(conflict.finishedAt === undefined ? {} : { finishedAt: conflict.finishedAt }),
  };
}

function toReflectionRow(reflection: MemoryFile["reflectionLogs"][number]): MemoryReflectionRow {
  return {
    id: reflection.id,
    createdAt: reflection.createdAt,
    type: reflection.type,
    sourceMemoryIds: structuredClone(reflection.sourceMemoryIds),
    acceptedCount: reflection.acceptedCount,
    skippedCount: reflection.skippedCount,
  };
}

function appendSuccessAudit(
  draft: MemoryFile,
  timestamp: string,
  idFactory: () => string,
  metadata: MutationAuditMetadata,
): void {
  const entry: MemoryAuditEntry = {
    id: idFactory(),
    createdAt: timestamp,
    operation: metadata.operation,
    targetType: metadata.targetType,
    ...(metadata.targetId === undefined ? {} : { targetId: metadata.targetId }),
    ...(metadata.field === undefined ? {} : { field: metadata.field }),
    source: "user",
    result: "success",
  };
  draft.auditLogs = [...draft.auditLogs, entry].slice(-MEMORY_AUDIT_LOG_LIMIT);
}

function validateProfileUpdate(
  input: UpdateProfileFieldInput,
): { ok: true; value: ProfileValue } | { ok: false; result: MemoryMutationResult } {
  if (!isRecord(input) || !isValidProfileField(input)) {
    return { ok: false, result: failure("invalid_content", "Memory field payload is invalid") };
  }
  const expectsArray = isArrayProfileField(input.layer, input.field);
  if ((expectsArray && !Array.isArray(input.value))
    || (!expectsArray && typeof input.value !== "string")) {
    return { ok: false, result: failure("invalid_content", "Memory field value has the wrong type") };
  }

  if (typeof input.value === "string") {
    const result = validateUserEditedMemoryContent(input.value);
    return result.ok
      ? { ok: true, value: result.content }
      : { ok: false, result: contentFailure(result.code) };
  }

  const normalized: string[] = [];
  for (const value of input.value) {
    if (typeof value !== "string") {
      return { ok: false, result: failure("invalid_content", "Memory field array is invalid") };
    }
    const result = validateUserEditedMemoryContent(value);
    if (!result.ok) return { ok: false, result: contentFailure(result.code) };
    normalized.push(result.content);
  }
  return { ok: true, value: normalized };
}

function isValidProfileField(
  input: unknown,
): input is UpdateProfileFieldInput | DeleteProfileFieldInput {
  if (!isRecord(input) || typeof input.field !== "string") return false;
  if (input.layer === "L0") {
    return L0_STRING_FIELDS.has(input.field as L0Field)
      || L0_ARRAY_FIELDS.has(input.field as L0Field);
  }
  if (input.layer === "L1") {
    return L1_STRING_FIELDS.has(input.field as L1Field)
      || L1_ARRAY_FIELDS.has(input.field as L1Field);
  }
  return false;
}

function isArrayProfileField(layer: "L0" | "L1", field: string): boolean {
  return layer === "L0"
    ? L0_ARRAY_FIELDS.has(field as L0Field)
    : L1_ARRAY_FIELDS.has(field as L1Field);
}

function profileFieldHasValue(profile: L0Profile | L1Profile, field: string): boolean {
  const value = (profile as unknown as Record<string, unknown>)[field];
  return typeof value === "string" ? value.length > 0 : Array.isArray(value) && value.length > 0;
}

function profileValuesEqual(current: unknown, next: ProfileValue): boolean {
  return JSON.stringify(current) === JSON.stringify(next);
}

function profileForLayer(
  memory: MemoryFile,
  layer: "L0" | "L1",
): L0Profile | L1Profile {
  return layer === "L0" ? memory.l0 : memory.l1;
}

function requireMemory(draft: MemoryFile, id: string): L2MemoryV2 {
  const memory = draft.l2.find((item) => item.id === id);
  if (!memory) throw new MutationRejected("not_found", "Memory was not found");
  return memory;
}

function deleteMemoryCascade(draft: MemoryFile, id: string, timestamp: string): void {
  const deleted = requireMemory(draft, id);
  const removedEvidenceIds = collectOwnedEvidenceIds(draft, deleted);
  draft.l2 = draft.l2.filter((memory) => memory.id !== id);
  draft.evidence = draft.evidence.filter((evidence) => (
    evidence.memoryId !== id && !removedEvidenceIds.has(evidence.id)
  ));

  for (const memory of draft.l2) {
    memory.evidenceIds = memory.evidenceIds.filter((evidenceId) => (
      !removedEvidenceIds.has(evidenceId)
    ));
    memory.conflictWith = memory.conflictWith.filter((relatedId) => relatedId !== id);
    if (memory.supersededBy === id) delete memory.supersededBy;
    if (memory.mergedInto === id) delete memory.mergedInto;
    const removedSourceId = memory.sourceMemoryIds.includes(id);
    const removedSourceSnapshot = memory.sourceSnapshots.some((snapshot) => (
      snapshot.memoryId === id
    ));
    memory.sourceMemoryIds = memory.sourceMemoryIds.filter((sourceId) => sourceId !== id);
    memory.sourceSnapshots = memory.sourceSnapshots.filter((snapshot) => snapshot.memoryId !== id);
    if (memory.isSummary && (removedSourceId || removedSourceSnapshot)) {
      memory.isEnabled = false;
      memory.syncStatus = "sync_failed";
      memory.updatedAt = timestamp;
    }
  }

  for (const evidence of draft.evidence) {
    evidence.sourceMemoryIds = evidence.sourceMemoryIds.filter((sourceId) => sourceId !== id);
  }
  for (const reflection of draft.reflectionLogs) {
    reflection.sourceMemoryIds = reflection.sourceMemoryIds.filter((sourceId) => sourceId !== id);
  }
  makeConflictHistoryNonExecutable(draft, new Set([id]), timestamp);
}

function collectOwnedEvidenceIds(draft: MemoryFile, memory: L2MemoryV2): Set<string> {
  const evidenceIds = new Set(memory.evidenceIds);
  for (const evidence of draft.evidence) {
    if (evidence.memoryId === memory.id) evidenceIds.add(evidence.id);
  }
  return evidenceIds;
}

function restoreMemory(draft: MemoryFile, id: string, timestamp: string): void {
  const memory = requireMemory(draft, id);
  memory.status = "active";
  memory.syncStatus = "pending_sync";
  memory.conflictWith = [];
  delete memory.supersededBy;
  delete memory.mergedInto;
  for (const candidate of draft.l2) {
    if (candidate.id !== id) {
      candidate.conflictWith = candidate.conflictWith.filter((relatedId) => relatedId !== id);
    }
  }
  makeConflictHistoryNonExecutable(draft, new Set([id]), timestamp);
}

function makeConflictHistoryNonExecutable(
  draft: MemoryFile,
  affectedIds: ReadonlySet<string>,
  timestamp: string,
): void {
  for (const conflict of draft.conflictLogs) {
    if ((affectedIds.has(conflict.sourceMemoryId) || affectedIds.has(conflict.targetMemoryId))
      && EXECUTABLE_CONFLICT_STATUSES.has(conflict.status)) {
      conflict.status = "failed";
      conflict.finishedAt = timestamp;
    }
  }
}

function layerNeedsCleanup(memory: MemoryFile, layer: "L0" | "L1" | "L2"): boolean {
  if (layer === "L2") {
    return memory.l2.length > 0
      || memory.evidence.length > 0
      || memory.conflictLogs.some((log) => EXECUTABLE_CONFLICT_STATUSES.has(log.status))
      || memory.reflectionLogs.some((log) => log.sourceMemoryIds.length > 0);
  }
  const profile = profileForLayer(memory, layer);
  return Object.entries(profile).some(([field, value]) => {
    if (field === "updatedAt" || field === "fieldMetadata") return false;
    return typeof value === "string" ? value.length > 0 : Array.isArray(value) && value.length > 0;
  });
}

function clearMemoryLayer(
  draft: MemoryFile,
  layer: "L0" | "L1" | "L2",
  timestamp: string,
): void {
  if (layer === "L0") {
    draft.l0 = {
      longTermInterests: [],
      permanentNotes: [],
      updatedAt: timestamp,
      fieldMetadata: {},
    };
    return;
  }
  if (layer === "L1") {
    draft.l1 = {
      recentGoals: [],
      recentPreferences: [],
      updatedAt: timestamp,
      fieldMetadata: {},
    };
    return;
  }

  draft.l2 = [];
  draft.evidence = [];
  for (const reflection of draft.reflectionLogs) {
    reflection.sourceMemoryIds = [];
  }
  for (const conflict of draft.conflictLogs) {
    if (EXECUTABLE_CONFLICT_STATUSES.has(conflict.status)) {
      conflict.status = "failed";
      conflict.finishedAt = timestamp;
    }
  }
}

function failure(code: MemoryMutationErrorCode, message: string): MemoryMutationResult {
  return { ok: false, code, message };
}

function contentFailure(code: string): MemoryMutationResult {
  return failure("invalid_content", `Memory content is not allowed: ${code}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
