export interface MemoryWriteQueue {
  schedule(task: () => Promise<void>, onError?: (error: unknown) => void): void;
  pendingCount(): number;
  flush(): Promise<void>;
}

export function createMemoryWriteQueue(): MemoryWriteQueue {
  let pending = 0;
  let tail = Promise.resolve();

  return {
    schedule(task, onError) {
      pending += 1;
      tail = tail
        .then(task)
        .catch((error: unknown) => {
          try {
            void Promise.resolve(onError?.(error)).catch(() => {});
          } catch {
            // Error reporting must not poison later memory writes.
          }
        })
        .finally(() => {
          pending -= 1;
        });
    },
    pendingCount() {
      return pending;
    },
    flush() {
      return tail;
    },
  };
}
