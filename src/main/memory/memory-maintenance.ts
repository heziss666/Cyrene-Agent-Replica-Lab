import { randomUUID } from "node:crypto";
import type { MemoryStore } from "./memory-store.js";
import type { MemoryAuditEntry, MemoryFile } from "./memory-types.js";

const AUDIT_LIMIT = 500;

export type MaintenanceReason = "manual" | "time" | "write_count";
export type MaintenanceStepName =
  | "resolver-idle"
  | "decay"
  | "l1-expiry"
  | "reflection"
  | "compression"
  | "entity-graph"
  | "audit";

export const MAINTENANCE_ERROR_CODES = {
  "resolver-idle": "MEMORY_MAINTENANCE_RESOLVER_FAILED",
  decay: "MEMORY_MAINTENANCE_DECAY_FAILED",
  "l1-expiry": "MEMORY_MAINTENANCE_L1_EXPIRY_FAILED",
  reflection: "MEMORY_MAINTENANCE_REFLECTION_FAILED",
  compression: "MEMORY_MAINTENANCE_COMPRESSION_FAILED",
  "entity-graph": "MEMORY_MAINTENANCE_ENTITY_GRAPH_FAILED",
  audit: "MEMORY_MAINTENANCE_AUDIT_FAILED",
} as const satisfies Record<MaintenanceStepName, string>;

export const STALE_RUNNING_RECOVERY_CODE = "MEMORY_MAINTENANCE_STALE_RUNNING_RECOVERED";

export type MaintenanceStepResult =
  | { ok: true; value: unknown }
  | { skipped: true; reason: "not_configured" | "dependency_failed" }
  | { failed: true; code: string };

export interface MaintenanceRunSummary {
  reason: MaintenanceReason;
  steps: Partial<Record<MaintenanceStepName, MaintenanceStepResult>>;
  errorCodes: string[];
}

interface ResolverQueueLike {
  flush(): Promise<void>;
}

interface DecayServiceLike {
  runDecay(): Promise<unknown>;
}

interface L1ExpiryServiceLike {
  expireL1(): Promise<unknown>;
}

type MaintenanceCallback = () => Promise<unknown> | unknown;

export interface MaintenanceCoordinatorOptions {
  store: MemoryStore;
  resolverQueue: ResolverQueueLike;
  decayService: DecayServiceLike;
  l1ExpiryService: L1ExpiryServiceLike;
  reflection?: MaintenanceCallback;
  compression?: MaintenanceCallback;
  entityGraph?: MaintenanceCallback;
  audit: MaintenanceCallback;
  now?: () => Date;
  idFactory?: () => string;
}

export class MaintenanceCoordinator {
  private readonly options: MaintenanceCoordinatorOptions;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private initialization?: Promise<void>;

  constructor(options: MaintenanceCoordinatorOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  initialize(): Promise<void> {
    this.initialization ??= this.recoverStaleRunning();
    return this.initialization;
  }

  async runNow(reason: MaintenanceReason): Promise<MaintenanceRunSummary> {
    await this.initialize();
    validNow(this.now());
    await this.options.store.update((draft) => {
      draft.maintenance.running = true;
      draft.maintenance.successfulWritesSinceMaintenance = 0;
    });

    const summary: MaintenanceRunSummary = { reason, steps: {}, errorCodes: [] };
    try {
      await this.runRequired(summary, "resolver-idle", () => this.options.resolverQueue.flush());
      const decaySucceeded = await this.runRequired(
        summary,
        "decay",
        () => this.options.decayService.runDecay(),
      );
      if (!decaySucceeded) {
        skipDependencies(summary, [
          "l1-expiry", "reflection", "compression", "entity-graph",
        ]);
      } else {
        const expirySucceeded = await this.runRequired(
          summary,
          "l1-expiry",
          () => this.options.l1ExpiryService.expireL1(),
        );
        if (!expirySucceeded) {
          skipDependencies(summary, ["reflection", "compression", "entity-graph"]);
        } else {
          const reflectionSucceeded = await this.runOptional(
            summary,
            "reflection",
            this.options.reflection,
          );
          if (reflectionSucceeded) {
            await this.runOptional(summary, "compression", this.options.compression);
          } else {
            summary.steps.compression = { skipped: true, reason: "dependency_failed" };
          }
          await this.runOptional(summary, "entity-graph", this.options.entityGraph);
        }
      }
      await this.runRequired(summary, "audit", this.options.audit);
      return summary;
    } finally {
      const finishedAt = validNow(this.now());
      await this.options.store.update((draft) => {
        draft.maintenance.running = false;
        draft.maintenance.lastMaintenanceAt = finishedAt.toISOString();
        const lastErrorCode = summary.errorCodes.at(-1);
        if (lastErrorCode === undefined) delete draft.maintenance.lastErrorCode;
        else draft.maintenance.lastErrorCode = lastErrorCode;
        appendRunAudit(draft, finishedAt, reason, lastErrorCode, this.idFactory);
      });
    }
  }

  private async recoverStaleRunning(): Promise<void> {
    const snapshot = await this.options.store.load();
    if (!snapshot.maintenance.running) return;
    const now = validNow(this.now());
    await this.options.store.update((draft) => {
      if (!draft.maintenance.running) return;
      draft.maintenance.running = false;
      draft.maintenance.lastErrorCode = STALE_RUNNING_RECOVERY_CODE;
      const audit: MemoryAuditEntry = {
        id: this.idFactory(),
        createdAt: now.toISOString(),
        operation: "recover_maintenance",
        targetType: "maintenance",
        source: "system",
        result: "success",
        code: STALE_RUNNING_RECOVERY_CODE,
      };
      draft.auditLogs = [...draft.auditLogs, audit].slice(-AUDIT_LIMIT);
    });
  }

  private async runRequired(
    summary: MaintenanceRunSummary,
    name: MaintenanceStepName,
    callback: MaintenanceCallback,
  ): Promise<boolean> {
    try {
      summary.steps[name] = { ok: true, value: await callback() };
      return true;
    } catch {
      const code = MAINTENANCE_ERROR_CODES[name];
      summary.steps[name] = { failed: true, code };
      summary.errorCodes.push(code);
      return false;
    }
  }

  private async runOptional(
    summary: MaintenanceRunSummary,
    name: MaintenanceStepName,
    callback: MaintenanceCallback | undefined,
  ): Promise<boolean> {
    if (!callback) {
      summary.steps[name] = { skipped: true, reason: "not_configured" };
      return true;
    }
    return this.runRequired(summary, name, callback);
  }
}

function skipDependencies(
  summary: MaintenanceRunSummary,
  names: readonly MaintenanceStepName[],
): void {
  for (const name of names) {
    summary.steps[name] = { skipped: true, reason: "dependency_failed" };
  }
}

function appendRunAudit(
  draft: MemoryFile,
  now: Date,
  reason: MaintenanceReason,
  errorCode: string | undefined,
  idFactory: () => string,
): void {
  const audit: MemoryAuditEntry = {
    id: idFactory(),
    createdAt: now.toISOString(),
    operation: "run_maintenance",
    targetType: "maintenance",
    source: reason === "manual" ? "user" : "automatic",
    result: errorCode === undefined ? "success" : "failed",
    code: errorCode ?? "MEMORY_MAINTENANCE_COMPLETED",
  };
  draft.auditLogs = [...draft.auditLogs, audit].slice(-AUDIT_LIMIT);
}

function validNow(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Invalid timestamp: now");
  }
  return value;
}

export { MaintenanceCoordinator as MemoryMaintenanceCoordinator };
