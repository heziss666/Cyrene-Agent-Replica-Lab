import type {
  MemoryAuditFinding,
  MemoryAuditFindingCode,
  MemoryAuditReport,
} from "../../shared/memory-api-types.js";
import type { ConflictLog, L2MemoryV2, MemoryFile } from "./memory-types.js";

const LIVE_CONFLICT_STATUSES = new Set<ConflictLog["status"]>([
  "queued",
  "processing",
  "uncertain",
]);

export function auditMemoryFile(memory: MemoryFile): MemoryAuditReport {
  const findings: MemoryAuditFinding[] = [];
  const memoriesById = new Map(memory.l2.map((item) => [item.id, item]));
  const evidenceById = new Map(memory.evidence.map((item) => [item.id, item]));

  for (const item of memory.l2) {
    if (item.evidenceIds.length === 0) {
      findings.push(finding("missing_evidence", "error", item.id));
    }
    for (const evidenceId of item.evidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence || evidence.memoryId !== item.id) {
        findings.push(finding("missing_evidence", "error", item.id, evidenceId));
      }
    }

    addBrokenLinkFinding(findings, memoriesById, item, "supersededBy");
    addBrokenLinkFinding(findings, memoriesById, item, "mergedInto");

    for (const relatedId of item.conflictWith) {
      if (!hasLiveConflict(memory.conflictLogs, item.id, relatedId)) {
        findings.push(finding(
          "active_conflict_without_live_log",
          "warning",
          item.id,
          relatedId,
        ));
      }
    }

    if (item.isSummary) {
      for (const sourceId of item.sourceMemoryIds) {
        if (!memoriesById.has(sourceId)) {
          findings.push(finding(
            "summary_source_missing",
            "error",
            item.id,
            sourceId,
          ));
        }
      }
    }
  }

  return { ok: findings.length === 0, findings };
}

function finding(
  code: MemoryAuditFindingCode,
  severity: MemoryAuditFinding["severity"],
  targetId: string,
  relatedId?: string,
): MemoryAuditFinding {
  return {
    code,
    severity,
    targetId,
    ...(relatedId === undefined ? {} : { relatedId }),
  };
}

function addBrokenLinkFinding(
  findings: MemoryAuditFinding[],
  memoriesById: ReadonlyMap<string, L2MemoryV2>,
  memory: L2MemoryV2,
  field: "supersededBy" | "mergedInto",
): void {
  const relatedId = memory[field];
  if (!relatedId || memoriesById.has(relatedId)) return;
  findings.push(finding(
    field === "supersededBy" ? "broken_superseded_by" : "broken_merged_into",
    "error",
    memory.id,
    relatedId,
  ));
}

function hasLiveConflict(
  logs: readonly ConflictLog[],
  firstId: string,
  secondId: string,
): boolean {
  return logs.some((log) => LIVE_CONFLICT_STATUSES.has(log.status)
    && ((log.sourceMemoryId === firstId && log.targetMemoryId === secondId)
      || (log.sourceMemoryId === secondId && log.targetMemoryId === firstId)));
}
