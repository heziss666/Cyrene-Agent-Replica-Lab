import type { ConflictPriority } from "./memory-types.js";

export interface MemoryResolverQueueTask {
  id: string;
  priority: ConflictPriority;
  createdAt: string;
  run: () => Promise<void>;
  onFinalFailure?: (error: unknown) => Promise<void> | void;
}

export interface MemoryResolverQueue {
  schedule(task: MemoryResolverQueueTask): void;
  pendingCount(): number;
  flush(): Promise<void>;
}

const priorityRank: Record<ConflictPriority, number> = { high: 0, normal: 1, idle: 2 };
const MAX_RETRIES = 2;

export function createMemoryResolverQueue(): MemoryResolverQueue {
  const tasks: Array<MemoryResolverQueueTask & { sequence: number }> = [];
  let sequence = 0;
  let pending = 0;
  let draining = false;
  let tail = Promise.resolve();

  function requestDrain(): void {
    if (draining) return;
    draining = true;
    tail = tail.then(async () => {
      while (tasks.length > 0) {
        const task = takeNextTask(tasks);
        try {
          await runWithRetries(task);
        } finally {
          pending -= 1;
        }
      }
      draining = false;
    }).catch(() => {
      draining = false;
    });
  }

  return {
    schedule(task) {
      tasks.push({ ...task, sequence: sequence++ });
      pending += 1;
      requestDrain();
    },
    pendingCount() { return pending; },
    async flush() {
      while (true) {
        const stableTail = tail;
        await stableTail;
        if (stableTail === tail && pending === 0) return;
      }
    },
  };
}

function takeNextTask(tasks: Array<MemoryResolverQueueTask & { sequence: number }>): MemoryResolverQueueTask & { sequence: number } {
  tasks.sort((first, second) => priorityRank[first.priority] - priorityRank[second.priority]
    || first.createdAt.localeCompare(second.createdAt)
    || first.sequence - second.sequence);
  return tasks.shift()!;
}

async function runWithRetries(task: MemoryResolverQueueTask): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await task.run();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  try {
    await task.onFinalFailure?.(lastError);
  } catch {
    // A failed error handler must not poison the stable queue tail.
  }
}
