import { randomUUID } from "node:crypto";
import { calculateDecayedMemory } from "./memory-lifecycle.js";
import type { MemoryStore } from "./memory-store.js";
import type { L2MemoryV2, MemoryAuditEntry, MemoryFile } from "./memory-types.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const AUDIT_LIMIT = 500;

export interface LifecycleCounts {
  activeToAging: number;
  agingToArchived: number;
  weightUpdated: number;
}

export type LifecycleSummary = LifecycleCounts | { skipped: true; reason: "interval" };

export interface MemoryDecayServiceOptions {
  store: MemoryStore;
  now?: () => Date;
  idFactory?: () => string;
}

const EMPTY_SUMMARY: LifecycleCounts = {
  activeToAging: 0,
  agingToArchived: 0,
  weightUpdated: 0,
};

export class MemoryDecayService {
  private readonly store: MemoryStore;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: MemoryDecayServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async runDecay(now = this.now()): Promise<LifecycleSummary> {
    assertValidDate(now, "now");
    const summary: LifecycleCounts = { ...EMPTY_SUMMARY };
    let skippedForInterval = false;

    await this.store.update((draft) => {
      const lastDecayAt = draft.maintenance.lastDecayAt;
      if (lastDecayAt === undefined) {
        applyDecay(draft, now, 0, summary, this.idFactory);
        return;
      }

      const lastDecayTime = parseTimestamp(lastDecayAt, "maintenance.lastDecayAt");
      const elapsedMs = now.getTime() - lastDecayTime;
      if (elapsedMs < 0) {
        throw new Error("Invalid timestamp: maintenance.lastDecayAt is after now");
      }
      if (elapsedMs === 0) return;
      if (elapsedMs < DAY_MS) {
        skippedForInterval = true;
        return;
      }

      validateEligibleAccessTimestamps(draft.l2);
      applyDecay(draft, now, elapsedMs / DAY_MS, summary, this.idFactory);
    });

    return skippedForInterval ? { skipped: true, reason: "interval" } : summary;
  }
}

function applyDecay(
  draft: MemoryFile,
  now: Date,
  elapsedDays: number,
  summary: LifecycleCounts,
  idFactory: () => string,
): void {
  for (let index = 0; index < draft.l2.length; index += 1) {
    const current = draft.l2[index];
    const next = calculateDecayedMemory(current, elapsedDays, now);
    if (current.status === "active" && next.status === "aging") {
      summary.activeToAging += 1;
    }
    if (current.status === "aging" && next.status === "archived") {
      summary.agingToArchived += 1;
    }
    if (current.weight !== next.weight) summary.weightUpdated += 1;
    draft.l2[index] = next;
  }

  const timestamp = now.toISOString();
  draft.maintenance.lastDecayAt = timestamp;
  const audit: MemoryAuditEntry = {
    id: idFactory(),
    createdAt: timestamp,
    operation: "decay_memory",
    targetType: "L2",
    source: "automatic",
    result: "success",
    code: summaryCode(summary),
  };
  draft.auditLogs = [...draft.auditLogs, audit].slice(-AUDIT_LIMIT);
}

function validateEligibleAccessTimestamps(memories: readonly L2MemoryV2[]): void {
  for (const memory of memories) {
    if (memory.status === "active" || memory.status === "aging") {
      parseTimestamp(memory.lastAccessedAt, `l2.${memory.id}.lastAccessedAt`);
    }
  }
}

function summaryCode(summary: LifecycleCounts): string {
  return `activeToAging=${summary.activeToAging};agingToArchived=${summary.agingToArchived};weightUpdated=${summary.weightUpdated}`;
}

function assertValidDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`Invalid timestamp: ${label}`);
  }
}

function parseTimestamp(value: string, label: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid timestamp: ${label}`);
  return timestamp;
}
