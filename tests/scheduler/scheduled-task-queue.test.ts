import { describe, expect, it } from "vitest";
import { createScheduledTaskQueue } from "../../src/main/scheduler/scheduled-task-queue.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("scheduled task queue", () => {
  it("runs different tasks FIFO with global concurrency one", async () => {
    const queue = createScheduledTaskQueue();
    const gate = deferred();
    const order: string[] = [];
    expect(await queue.enqueue({ taskId: "a", runId: "1", run: async () => {
      order.push("a-start"); await gate.promise; order.push("a-end");
    }, cancel: async () => undefined })).toBe("queued");
    expect(await queue.enqueue({ taskId: "b", runId: "2", run: async () => {
      order.push("b");
    }, cancel: async () => undefined })).toBe("queued");
    await Promise.resolve();
    expect(order).toEqual(["a-start"]);
    expect(queue.pendingCount()).toBe(2);
    gate.resolve();
    await queue.flush();
    expect(order).toEqual(["a-start", "a-end", "b"]);
  });

  it("rejects overlap while a task is queued or running", async () => {
    const queue = createScheduledTaskQueue();
    const gate = deferred();
    await queue.enqueue({ taskId: "same", runId: "1", run: () => gate.promise, cancel: async () => undefined });
    expect(await queue.enqueue({ taskId: "same", runId: "2", run: async () => undefined, cancel: async () => undefined }))
      .toBe("overlap");
    gate.resolve();
    await queue.flush();
  });

  it("cancels queued work and rejects new work during shutdown", async () => {
    const queue = createScheduledTaskQueue();
    const gate = deferred();
    let cancelled = false;
    await queue.enqueue({ taskId: "active", runId: "1", run: () => gate.promise, cancel: async () => undefined });
    await queue.enqueue({ taskId: "queued", runId: "2", run: async () => undefined, cancel: async () => { cancelled = true; } });
    const shutdown = queue.beginShutdown();
    await expect(queue.enqueue({ taskId: "new", runId: "3", run: async () => undefined, cancel: async () => undefined }))
      .rejects.toThrow("SCHEDULE_SHUTTING_DOWN");
    expect(cancelled).toBe(true);
    gate.resolve();
    await shutdown;
  });

  it("continues after a rejected job", async () => {
    const queue = createScheduledTaskQueue();
    let later = false;
    await queue.enqueue({ taskId: "bad", runId: "1", run: async () => { throw new Error("bad"); }, cancel: async () => undefined });
    await queue.enqueue({ taskId: "later", runId: "2", run: async () => { later = true; }, cancel: async () => undefined });
    await queue.flush();
    expect(later).toBe(true);
  });
});
