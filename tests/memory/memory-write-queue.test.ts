import { describe, expect, it, vi } from "vitest";
import { createMemoryWriteQueue } from "../../src/main/memory/memory-write-queue.js";

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("createMemoryWriteQueue", () => {
  it("returns from schedule before deferred work completes and runs tasks in insertion order", async () => {
    const queue = createMemoryWriteQueue();
    const order: string[] = [];
    const gate = createDeferred();

    queue.schedule(async () => {
      order.push("first-start");
      await gate.promise;
      order.push("first-end");
    });
    queue.schedule(async () => {
      order.push("second");
    });

    expect(queue.pendingCount()).toBe(2);
    expect(order).toEqual([]);

    await Promise.resolve();
    expect(order).toEqual(["first-start"]);

    gate.resolve();
    await queue.flush();

    expect(order).toEqual(["first-start", "first-end", "second"]);
    expect(queue.pendingCount()).toBe(0);
  });

  it("notifies a rejected task and continues with later work", async () => {
    const queue = createMemoryWriteQueue();
    const failure = new Error("memory write failed");
    const onError = vi.fn();
    const order: string[] = [];

    queue.schedule(async () => {
      order.push("failed");
      throw failure;
    }, onError);
    queue.schedule(async () => {
      order.push("later");
    });

    await queue.flush();

    expect(onError).toHaveBeenCalledWith(failure);
    expect(order).toEqual(["failed", "later"]);
    expect(queue.pendingCount()).toBe(0);
  });

  it("absorbs an onError failure without rejecting flush or blocking later work", async () => {
    const queue = createMemoryWriteQueue();
    const taskFailure = new Error("task failed");
    const callbackFailure = new Error("error callback failed");
    const onError = vi.fn(() => {
      throw callbackFailure;
    });
    const laterWork = vi.fn();

    queue.schedule(async () => {
      throw taskFailure;
    }, onError);
    queue.schedule(async () => {
      laterWork();
    });

    await expect(queue.flush()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(taskFailure);
    expect(laterWork).toHaveBeenCalledOnce();
    expect(queue.pendingCount()).toBe(0);
  });

  it("absorbs an async onError rejection without blocking later work", async () => {
    const queue = createMemoryWriteQueue();
    const taskFailure = new Error("task failed");
    const callbackFailure = new Error("callback failed");
    const onError = vi.fn(async () => {
      throw callbackFailure;
    });
    const laterWork = vi.fn();

    queue.schedule(async () => {
      throw taskFailure;
    }, onError);
    queue.schedule(async () => {
      laterWork();
    });

    await expect(queue.flush()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(taskFailure);
    expect(laterWork).toHaveBeenCalledOnce();
    expect(queue.pendingCount()).toBe(0);
  });

  it("observes a rejecting onError thenable without blocking later work", async () => {
    const queue = createMemoryWriteQueue();
    const callbackFailure = new Error("thenable callback failed");
    let observed = false;
    const rejectedThenable = {
      then: (_resolve: () => void, reject: (reason: unknown) => void) => {
        observed = true;
        reject(callbackFailure);
        return Promise.resolve();
      },
    } as PromiseLike<void>;
    const laterWork = vi.fn();

    queue.schedule(async () => {
      throw new Error("task failed");
    }, () => rejectedThenable);
    queue.schedule(async () => {
      laterWork();
    });

    await queue.flush();
    await Promise.resolve();

    expect(observed).toBe(true);
    expect(laterWork).toHaveBeenCalledOnce();
    expect(queue.pendingCount()).toBe(0);
  });

  it("handles a synchronously thrown task and continues with later work", async () => {
    const queue = createMemoryWriteQueue();
    const taskFailure = new Error("task failed synchronously");
    const onError = vi.fn();
    const laterWork = vi.fn();

    queue.schedule(() => {
      throw taskFailure;
    }, onError);
    queue.schedule(async () => {
      laterWork();
    });

    await expect(queue.flush()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(taskFailure);
    expect(laterWork).toHaveBeenCalledOnce();
    expect(queue.pendingCount()).toBe(0);
  });

  it("flush waits for work appended while the drain is in progress", async () => {
    const queue = createMemoryWriteQueue();
    const firstGate = createDeferred();
    const secondGate = createDeferred();
    let flushSettled = false;

    queue.schedule(async () => {
      await firstGate.promise;
    });
    const flush = queue.flush().then(() => {
      flushSettled = true;
    });
    queue.schedule(async () => {
      await secondGate.promise;
    });

    firstGate.resolve();
    for (let turn = 0; turn < 5; turn += 1) {
      await Promise.resolve();
    }

    expect(flushSettled).toBe(false);
    expect(queue.pendingCount()).toBe(1);

    secondGate.resolve();
    await flush;
    expect(flushSettled).toBe(true);
    expect(queue.pendingCount()).toBe(0);
  });
});
