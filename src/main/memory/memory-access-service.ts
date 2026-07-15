import { randomUUID } from "node:crypto";
import { reinforceMemory } from "./memory-lifecycle.js";
import type { MemoryStore } from "./memory-store.js";
import type { MemoryAuditEntry } from "./memory-types.js";

const AUDIT_LIMIT = 500;

export interface MemoryAccessServiceOptions {
  store: MemoryStore;
  now?: () => Date;
  idFactory?: () => string;
}

export interface MemoryAccessResult {
  updatedIds: string[];
}

export class MemoryAccessService {
  private readonly store: MemoryStore;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: MemoryAccessServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async recordInjected(ids: readonly string[]): Promise<MemoryAccessResult> {
    const uniqueIds = [...new Set(ids)];
    const updatedIds: string[] = [];
    if (uniqueIds.length === 0) return { updatedIds };

    await this.store.update((draft) => {
      const timestamp = this.now();
      for (const id of uniqueIds) {
        const index = draft.l2.findIndex((memory) => memory.id === id);
        if (index < 0) continue;
        const memory = draft.l2[index];
        if (!memory.isEnabled || (memory.status !== "active" && memory.status !== "aging")) {
          continue;
        }
        draft.l2[index] = reinforceMemory(memory, timestamp);
        updatedIds.push(id);
      }

      const audit: MemoryAuditEntry = {
        id: this.idFactory(),
        createdAt: timestamp.toISOString(),
        operation: "reinforce_memory_access",
        targetType: "L2",
        source: "automatic",
        result: "success",
        code: `updated_${updatedIds.length}`,
      };
      draft.auditLogs = [...draft.auditLogs, audit].slice(-AUDIT_LIMIT);
    });

    return { updatedIds };
  }
}
