import { randomUUID } from "node:crypto";
import type { MaintenanceReason } from "./memory-maintenance.js";
import type { MemoryStore } from "./memory-store.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const WRITE_TRIGGER = 10;
const SHUTDOWN_CODE = "MEMORY_MAINTENANCE_SHUTTING_DOWN";

export interface MaintenanceRunner {
  initialize(): Promise<void>;
  runNow(reason: MaintenanceReason, runId: string): Promise<unknown>;
}

export interface MemorySchedulerOptions {
  store: MemoryStore;
  coordinator: MaintenanceRunner;
  now?: () => Date;
  idFactory?: () => string;
}

export class MemoryScheduler {
  private readonly store: MemoryStore;
  private readonly coordinator: MaintenanceRunner;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly initialization: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private activeRunId?: string;
  private followUpReason?: MaintenanceReason;
  private tail: Promise<void> = Promise.resolve();
  private readonly acceptedOperations = new Set<Promise<unknown>>();
  private shuttingDown = false;
  private shutdownPromise?: Promise<void>;

  constructor(options: MemorySchedulerOptions) {
    this.store = options.store;
    this.coordinator = options.coordinator;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.initialization = this.initialize();
  }

  ready(): Promise<void> {
    return this.initialization;
  }

  recordSuccessfulWrite(): Promise<string | undefined> {
    try {
      this.assertAccepting();
    } catch (error) {
      return Promise.reject(error);
    }
    return this.trackAccepted(this.recordAcceptedWrite());
  }

  requestMaintenance(reason: MaintenanceReason): Promise<string> {
    try {
      this.assertAccepting();
    } catch (error) {
      return Promise.reject(error);
    }
    return this.trackAccepted(this.requestAcceptedMaintenance(reason));
  }

  private async recordAcceptedWrite(): Promise<string | undefined> {
    await this.initialization;
    let trigger = false;
    await this.store.update((draft) => {
      draft.maintenance.successfulWritesSinceMaintenance += 1;
      trigger = draft.maintenance.successfulWritesSinceMaintenance >= WRITE_TRIGGER;
    });
    return trigger ? this.requestAcceptedMaintenance("write_count") : undefined;
  }

  private async requestAcceptedMaintenance(reason: MaintenanceReason): Promise<string> {
    await this.initialization;
    this.clearTimer();

    if (this.activeRunId !== undefined) {
      this.followUpReason ??= reason;
      return this.activeRunId;
    }

    const runId = this.idFactory();
    this.activeRunId = runId;
    this.tail = this.drain(reason, runId);
    return runId;
  }

  runNow(): Promise<string> {
    return this.requestMaintenance("manual");
  }

  pendingCount(): number {
    return (this.activeRunId === undefined ? 0 : 1) + (this.followUpReason === undefined ? 0 : 1);
  }

  async flush(): Promise<void> {
    while (true) {
      const accepted = [...this.acceptedOperations];
      await Promise.allSettled(accepted);
      await this.initialization;
      const stableTail = this.tail;
      await stableTail;
      if (stableTail === this.tail
        && this.pendingCount() === 0
        && this.acceptedOperations.size === 0) return;
    }
  }

  beginShutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    this.shuttingDown = true;
    this.clearTimer();
    this.shutdownPromise = this.flush();
    return this.shutdownPromise;
  }

  private async initialize(): Promise<void> {
    await this.coordinator.initialize();
    if (this.shuttingDown) return;
    const snapshot = await this.store.load();
    if (this.shuttingDown) return;
    this.scheduleTimeTrigger(snapshot.maintenance.lastMaintenanceAt);
  }

  private async drain(initialReason: MaintenanceReason, initialRunId: string): Promise<void> {
    let reason: MaintenanceReason | undefined = initialReason;
    let runId = initialRunId;
    try {
      while (reason !== undefined) {
        await this.coordinator.runNow(reason, runId).catch(() => undefined);
        reason = this.followUpReason;
        this.followUpReason = undefined;
        if (reason !== undefined) {
          runId = this.idFactory();
          this.activeRunId = runId;
        }
      }
    } finally {
      this.activeRunId = undefined;
      this.followUpReason = undefined;
      if (!this.shuttingDown) {
        const snapshot = await this.store.load().catch(() => undefined);
        if (snapshot) this.scheduleTimeTrigger(snapshot.maintenance.lastMaintenanceAt);
      }
    }
  }

  private scheduleTimeTrigger(lastMaintenanceAt: string | undefined): void {
    this.clearTimer();
    if (this.shuttingDown) return;
    const now = validNow(this.now()).getTime();
    const last = lastMaintenanceAt === undefined ? now : Date.parse(lastMaintenanceAt);
    const delay = Number.isFinite(last) ? Math.max(0, last + DAY_MS - now) : 0;
    this.timer = setTimeout(() => {
      void this.requestMaintenance("time").catch(() => undefined);
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private trackAccepted<T>(operation: Promise<T>): Promise<T> {
    this.acceptedOperations.add(operation);
    void operation.finally(() => {
      this.acceptedOperations.delete(operation);
    }).catch(() => undefined);
    return operation;
  }

  private assertAccepting(): void {
    if (this.shuttingDown) throw new Error(SHUTDOWN_CODE);
  }
}

function validNow(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Invalid timestamp: now");
  }
  return value;
}

export function createMemoryScheduler(options: MemorySchedulerOptions): MemoryScheduler {
  return new MemoryScheduler(options);
}
