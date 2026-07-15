import { randomUUID } from "node:crypto";
import type { MemoryStore } from "./memory-store.js";
import type { L1Field, MemoryAuditEntry, MemoryFile } from "./memory-types.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const AUDIT_LIMIT = 500;
const EXPIRY_DAYS = {
  currentProject: 90,
  recentGoals: 45,
  recentPreferences: 30,
} satisfies Record<L1Field, number>;
const L1_FIELDS = Object.keys(EXPIRY_DAYS) as L1Field[];

export interface L1ExpirySummary {
  expiredFields: L1Field[];
}

export interface MemoryL1ExpiryOptions {
  store: MemoryStore;
  now?: () => Date;
  idFactory?: () => string;
}

export class MemoryL1Expiry {
  private readonly store: MemoryStore;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: MemoryL1ExpiryOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async expireL1(now = this.now()): Promise<L1ExpirySummary> {
    assertValidDate(now);
    const expiredFields: L1Field[] = [];

    await this.store.update((draft) => {
      const updatedTimes = validateMetadataTimestamps(draft);
      for (const field of L1_FIELDS) {
        const updatedAt = updatedTimes.get(field);
        if (updatedAt === undefined) continue;
        if (now.getTime() - updatedAt < EXPIRY_DAYS[field] * DAY_MS) continue;

        clearField(draft, field);
        expiredFields.push(field);
      }

      appendAudit(draft, now, expiredFields, this.idFactory);
    });

    return { expiredFields };
  }
}

export { MemoryL1Expiry as MemoryL1ExpiryService };

function validateMetadataTimestamps(draft: MemoryFile): Map<L1Field, number> {
  const result = new Map<L1Field, number>();
  for (const field of L1_FIELDS) {
    const metadata = draft.l1.fieldMetadata?.[field];
    if (!metadata) continue;
    const timestamp = Date.parse(metadata.updatedAt);
    if (!Number.isFinite(timestamp)) {
      throw new Error(`Invalid timestamp: l1.fieldMetadata.${field}.updatedAt`);
    }
    result.set(field, timestamp);
  }
  return result;
}

function clearField(draft: MemoryFile, field: L1Field): void {
  if (field === "currentProject") delete draft.l1.currentProject;
  if (field === "recentGoals") draft.l1.recentGoals = [];
  if (field === "recentPreferences") draft.l1.recentPreferences = [];
  if (draft.l1.fieldMetadata) delete draft.l1.fieldMetadata[field];
}

function appendAudit(
  draft: MemoryFile,
  now: Date,
  expiredFields: readonly L1Field[],
  idFactory: () => string,
): void {
  const audit: MemoryAuditEntry = {
    id: idFactory(),
    createdAt: now.toISOString(),
    operation: "expire_l1",
    targetType: "L1",
    ...(expiredFields.length === 0 ? {} : { field: expiredFields.join(",") }),
    source: "automatic",
    result: "success",
    code: `expired=${expiredFields.length}`,
  };
  draft.auditLogs = [...draft.auditLogs, audit].slice(-AUDIT_LIMIT);
}

function assertValidDate(value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Invalid timestamp: now");
  }
}
