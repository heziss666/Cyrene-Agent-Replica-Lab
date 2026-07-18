export interface ScheduledQueueJob {
  taskId: string;
  runId: string;
  run(): Promise<void>;
  cancel(): Promise<void>;
}

export interface ScheduledTaskQueue {
  enqueue(job: ScheduledQueueJob): Promise<"queued" | "overlap">;
  beginShutdown(): Promise<void>;
  flush(): Promise<void>;
  pendingCount(): number;
}

export function createScheduledTaskQueue(): ScheduledTaskQueue {
  const pending: ScheduledQueueJob[] = [];
  const acceptedTaskIds = new Set<string>();
  let active: ScheduledQueueJob | undefined;
  let draining: Promise<void> | undefined;
  let shuttingDown = false;

  function startDrain(): void {
    draining ??= drain().finally(() => { draining = undefined; });
  }

  async function drain(): Promise<void> {
    while (pending.length > 0) {
      const job = pending.shift()!;
      active = job;
      try { await Promise.resolve().then(() => job.run()); } catch { /* Job owns terminal status. */ }
      finally {
        active = undefined;
        acceptedTaskIds.delete(job.taskId);
      }
    }
  }

  async function flush(): Promise<void> {
    while (true) {
      const current = draining;
      if (current) await current;
      if (!draining && !active && pending.length === 0) return;
    }
  }

  return {
    async enqueue(job) {
      if (shuttingDown) throw new Error("SCHEDULE_SHUTTING_DOWN");
      if (acceptedTaskIds.has(job.taskId)) return "overlap";
      acceptedTaskIds.add(job.taskId);
      pending.push(job);
      startDrain();
      return "queued";
    },
    async beginShutdown() {
      if (!shuttingDown) {
        shuttingDown = true;
        const cancelled = pending.splice(0);
        for (const job of cancelled) {
          acceptedTaskIds.delete(job.taskId);
          try { await job.cancel(); } catch { /* Continue cancelling. */ }
        }
      }
      await flush();
    },
    flush,
    pendingCount() {
      return pending.length + (active ? 1 : 0);
    },
  };
}
