import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryScheduler,
  type MaintenanceRunner,
} from "../../src/main/memory/memory-scheduler.js";
import type { MemoryStore } from "../../src/main/memory/memory-store.js";
import {
  createEmptyMemoryFileV2,
  type MemoryFile,
} from "../../src/main/memory/memory-types.js";

const START = new Date("2026-07-15T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function createStore(initial = createEmptyMemoryFileV2()) {
  let file = structuredClone(initial);
  const store: MemoryStore & { read(): MemoryFile } = {
    load: vi.fn(async () => structuredClone(file)),
    async update(mutator) {
      const draft = structuredClone(file);
      mutator(draft);
      file = draft;
      return structuredClone(file);
    },
    read: () => structuredClone(file),
  };
  return store;
}

function createScheduler(
  store: ReturnType<typeof createStore>,
  runNow = vi.fn<MaintenanceRunner["runNow"]>(async () => ({})),
) {
  let id = 0;
  const runner: MaintenanceRunner = { initialize: vi.fn(async () => undefined), runNow };
  return {
    runNow,
    scheduler: new MemoryScheduler({
      store,
      coordinator: runner,
      now: () => new Date(Date.now()),
      idFactory: () => `run-${++id}`,
    }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("MemoryScheduler", () => {
  it("triggers on exactly the tenth successful write", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const initial = createEmptyMemoryFileV2();
    initial.maintenance.lastMaintenanceAt = START.toISOString();
    const store = createStore(initial);
    const { scheduler, runNow } = createScheduler(store);
    await scheduler.ready();

    for (let index = 0; index < 9; index += 1) {
      await scheduler.recordSuccessfulWrite();
    }
    expect(runNow).not.toHaveBeenCalled();
    expect(store.read().maintenance.successfulWritesSinceMaintenance).toBe(9);

    await expect(scheduler.recordSuccessfulWrite()).resolves.toBe("run-1");
    await scheduler.flush();
    expect(runNow).toHaveBeenCalledOnce();
    expect(runNow).toHaveBeenCalledWith("write_count");
  });

  it("triggers when elapsed time reaches exactly 24 hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const initial = createEmptyMemoryFileV2();
    initial.maintenance.lastMaintenanceAt = START.toISOString();
    const store = createStore(initial);
    const { scheduler, runNow } = createScheduler(store);
    await scheduler.ready();

    await vi.advanceTimersByTimeAsync(DAY_MS - 1);
    expect(runNow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await scheduler.flush();

    expect(runNow).toHaveBeenCalledOnce();
    expect(runNow).toHaveBeenCalledWith("time");
  });

  it("coalesces repeated running requests into at most one follow-up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const initial = createEmptyMemoryFileV2();
    initial.maintenance.lastMaintenanceAt = START.toISOString();
    const store = createStore(initial);
    const first = deferred();
    const second = deferred();
    const runNow = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { scheduler } = createScheduler(store, runNow);
    await scheduler.ready();

    await expect(scheduler.requestMaintenance("manual")).resolves.toBe("run-1");
    await Promise.resolve();
    await expect(scheduler.requestMaintenance("manual")).resolves.toBe("run-1");
    await expect(scheduler.requestMaintenance("write_count")).resolves.toBe("run-1");
    expect(scheduler.pendingCount()).toBe(2);
    expect(runNow).toHaveBeenCalledTimes(1);

    first.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(runNow).toHaveBeenCalledTimes(2);
    second.resolve();
    await scheduler.flush();
    expect(runNow).toHaveBeenCalledTimes(2);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("beginShutdown rejects new triggers and drains all accepted work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const initial = createEmptyMemoryFileV2();
    initial.maintenance.lastMaintenanceAt = START.toISOString();
    const store = createStore(initial);
    const accepted = deferred();
    const { scheduler } = createScheduler(store, vi.fn(() => accepted.promise));
    await scheduler.ready();
    await scheduler.requestMaintenance("manual");

    let drained = false;
    const drain = scheduler.beginShutdown();
    expect(scheduler.beginShutdown()).toBe(drain);
    const shutdown = drain.then(() => { drained = true; });
    await expect(scheduler.requestMaintenance("manual"))
      .rejects.toThrow("MEMORY_MAINTENANCE_SHUTTING_DOWN");
    await expect(scheduler.recordSuccessfulWrite())
      .rejects.toThrow("MEMORY_MAINTENANCE_SHUTTING_DOWN");
    expect(drained).toBe(false);

    accepted.resolve();
    await shutdown;
    expect(drained).toBe(true);
  });
});
