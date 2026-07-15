import { randomUUID } from "node:crypto";
import type { MemoryStore } from "./memory-store.js";
import { isValidMemoryResolution, type MemoryResolution } from "./memory-resolver.js";
import type { ConflictLog, L2MemoryV2, MemoryAuditEntry, MemoryFile } from "./memory-types.js";

const AUDIT_LIMIT = 500;

export interface ApplyMemoryResolutionInput {
  store: MemoryStore;
  conflict: ConflictLog;
  source: L2MemoryV2;
  target: L2MemoryV2;
  sourceEvidenceIds: readonly string[];
  targetEvidenceIds: readonly string[];
  resolution: MemoryResolution;
  now?: () => Date;
  idFactory?: () => string;
}

export type ApplyMemoryResolutionResult =
  | { applied: true }
  | { applied: false; code: "invalid_resolution" | "missing" | "stale" };

export async function applyMemoryResolution(input: ApplyMemoryResolutionInput): Promise<ApplyMemoryResolutionResult> {
  if (!isValidMemoryResolution(input.resolution, input.conflict.sourceMemoryId, input.conflict.targetMemoryId)) {
    return { applied: false, code: "invalid_resolution" };
  }
  const now = input.now ?? (() => new Date());
  const idFactory = input.idFactory ?? randomUUID;
  let result: ApplyMemoryResolutionResult = { applied: false, code: "missing" };
  await input.store.update((draft) => {
    const conflict = draft.conflictLogs.find((item) => item.id === input.conflict.id);
    const source = draft.l2.find((item) => item.id === input.conflict.sourceMemoryId);
    const target = draft.l2.find((item) => item.id === input.conflict.targetMemoryId);
    if (!conflict || !source || !target) return;
    if (!matchesConflict(conflict, input.conflict)
      || !matchesSnapshot(source, input.source, input.sourceEvidenceIds, draft)
      || !matchesSnapshot(target, input.target, input.targetEvidenceIds, draft)) {
      result = { applied: false, code: "stale" };
      return;
    }

    const timestamp = now().toISOString();
    const destructiveTarget = targetForDestructiveAction(input.resolution, source, target);
    const canDestructivelyApply = input.resolution.resolutionType !== "direct_conflict"
      || (input.resolution.confidence >= 0.85 && hasCompleteEvidence(source, draft) && hasCompleteEvidence(target, draft));
    const mustDowngrade = destructiveTarget !== undefined && (destructiveTarget.isPinned || !canDestructivelyApply);
    if (mustDowngrade || input.resolution.resolutionType === "uncertain") {
      resolveUncertain(conflict, input.resolution, timestamp);
    } else if (destructiveTarget) {
      const winner = destructiveTarget.id === source.id ? target : source;
      destructiveTarget.status = "superseded";
      destructiveTarget.isEnabled = false;
      destructiveTarget.supersededBy = winner.id;
      destructiveTarget.updatedAt = timestamp;
      clearConflictPair(source, target);
      resolveConflict(conflict, input.resolution, timestamp);
    } else {
      source.status = "active";
      source.isEnabled = true;
      target.status = "active";
      target.isEnabled = true;
      clearConflictPair(source, target);
      resolveConflict(conflict, input.resolution, timestamp);
    }
    const audit: MemoryAuditEntry = {
      id: idFactory(),
      createdAt: timestamp,
      operation: "memory_conflict_resolution",
      targetType: "conflict",
      targetId: conflict.id,
      source: "automatic",
      result: "success",
      code: conflict.status,
    };
    draft.auditLogs = [...draft.auditLogs, audit].slice(-AUDIT_LIMIT);
    result = { applied: true };
  });
  return result;
}

function matchesConflict(current: ConflictLog, expected: ConflictLog): boolean {
  return current.sourceMemoryId === expected.sourceMemoryId
    && current.targetMemoryId === expected.targetMemoryId
    && (current.status === "queued" || current.status === "processing");
}

function matchesSnapshot(memory: L2MemoryV2, expected: L2MemoryV2, evidenceIds: readonly string[], file: MemoryFile): boolean {
  return memory.updatedAt === expected.updatedAt
    && sameIds(memory.evidenceIds, evidenceIds)
    && evidenceIds.every((id) => file.evidence.some((item) => item.id === id && item.memoryId === memory.id));
}

function hasCompleteEvidence(memory: L2MemoryV2, file: MemoryFile): boolean {
  if (memory.evidenceIds.length === 0) return false;
  const evidenceById = new Map(file.evidence.map((item) => [item.id, item]));
  return memory.evidenceIds.every((id) => evidenceById.get(id)?.memoryId === memory.id);
}

function sameIds(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((id) => second.includes(id)) && new Set(first).size === first.length;
}

function targetForDestructiveAction(resolution: MemoryResolution, source: L2MemoryV2, target: L2MemoryV2): L2MemoryV2 | undefined {
  if (resolution.actions[0] === "supersede_source") return source;
  if (resolution.actions[0] === "supersede_target") return target;
  return undefined;
}

function clearConflictPair(source: L2MemoryV2, target: L2MemoryV2): void {
  source.conflictWith = source.conflictWith.filter((id) => id !== target.id);
  target.conflictWith = target.conflictWith.filter((id) => id !== source.id);
}

function resolveConflict(conflict: ConflictLog, resolution: MemoryResolution, timestamp: string): void {
  conflict.status = "resolved";
  conflict.resolutionType = resolution.resolutionType;
  conflict.resolutionConfidence = resolution.confidence;
  conflict.resolutionReason = resolution.reason;
  conflict.finishedAt = timestamp;
}

function resolveUncertain(conflict: ConflictLog, resolution: MemoryResolution, timestamp: string): void {
  conflict.status = "uncertain";
  conflict.resolutionType = "uncertain";
  conflict.resolutionConfidence = resolution.confidence;
  conflict.resolutionReason = resolution.reason;
  conflict.finishedAt = timestamp;
}
