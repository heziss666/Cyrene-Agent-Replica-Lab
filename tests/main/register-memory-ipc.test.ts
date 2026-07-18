import { describe, expect, it, vi } from "vitest";
import {
  combineIpcShutdownRuntimes,
  registerMemoryIpc,
  type MemoryIpcEventLike,
  type MemoryIpcMainLike,
  type MemoryIpcRuntime,
} from "../../src/main/app/register-memory-ipc.js";
import type { ChatIpcRuntime } from "../../src/main/app/register-chat-ipc.js";
import type { MemoryGovernanceService } from "../../src/main/memory/memory-governance.js";
import { IPC_CHANNELS } from "../../src/shared/ipc-channels.js";

type IpcHandler = (event: MemoryIpcEventLike, payload?: unknown) => Promise<unknown>;

interface FakeIpcMain extends MemoryIpcMainLike {
  handlers: Map<string, IpcHandler>;
  removedChannels: string[];
}

function createFakeIpcMain(): FakeIpcMain {
  const handlers = new Map<string, IpcHandler>();
  const removedChannels: string[] = [];
  return {
    handlers,
    removedChannels,
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => {
      removedChannels.push(channel);
      handlers.delete(channel);
    },
  };
}

function createGovernance(): MemoryGovernanceService {
  return {
    snapshot: vi.fn(async () => ({ kind: "snapshot" }) as never),
    updateProfileField: vi.fn(async () => ({ kind: "update-profile" }) as never),
    updateL2: vi.fn(async () => ({ kind: "update-l2" }) as never),
    deleteProfileField: vi.fn(async () => ({ kind: "delete-profile" }) as never),
    deleteL2: vi.fn(async () => ({ kind: "delete-l2" }) as never),
    setL2Pinned: vi.fn(async () => ({ kind: "set-pinned" }) as never),
    setL2Enabled: vi.fn(async () => ({ kind: "set-enabled" }) as never),
    restoreL2: vi.fn(async () => ({ kind: "restore-l2" }) as never),
    clearLayer: vi.fn(async () => ({ kind: "clear-layer" }) as never),
    audit: vi.fn(async () => ({ kind: "audit" }) as never),
  };
}

function memoryChannels(): string[] {
  return [...Object.values(IPC_CHANNELS.memory), IPC_CHANNELS.memory.runMaintenance];
}

function handler(ipcMain: FakeIpcMain, channel: string): IpcHandler {
  const registered = ipcMain.handlers.get(channel);
  if (!registered) throw new Error(`Missing test handler for ${channel}`);
  return registered;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("registerMemoryIpc", () => {
  it("merges the rebuildable entity graph into snapshot reads", async () => {
    const ipcMain = createFakeIpcMain();
    registerMemoryIpc({
      ipcMain,
      governance: createGovernance(),
      entityGraph: { load: vi.fn(async () => ({ schemaVersion: 1 as const, generatedAt: "2026-07-16T00:00:00.000Z", nodes: [{ id: "technology:typescript", type: "technology" as const, name: "TypeScript", sourceMemoryIds: ["m1"] }], relations: [] })) },
    });
    await expect(handler(ipcMain, IPC_CHANNELS.memory.getSnapshot)({})).resolves.toMatchObject({
      kind: "snapshot",
      entityGraph: { nodes: [{ name: "TypeScript" }], relations: [] },
    });
  });

  it("registers all fixed channels and replaces stale handlers", () => {
    const ipcMain = createFakeIpcMain();
    for (const channel of memoryChannels()) {
      ipcMain.handlers.set(channel, vi.fn());
    }

    registerMemoryIpc({ ipcMain, governance: createGovernance() });

    expect([...ipcMain.handlers.keys()]).toEqual(memoryChannels());
    expect(ipcMain.removedChannels).toEqual(memoryChannels());
  });

  it("routes repeated manual maintenance requests through the shared scheduler", async () => {
    const ipcMain = createFakeIpcMain();
    const scheduler = {
      runNow: vi.fn(async () => "maintenance-run-7"),
      beginShutdown: vi.fn(async () => undefined),
      pendingCount: () => 1,
    };
    registerMemoryIpc({ ipcMain, governance: createGovernance(), memoryScheduler: scheduler });

    const runMaintenance = handler(ipcMain, IPC_CHANNELS.memory.runMaintenance);
    await expect(Promise.all([runMaintenance({}), runMaintenance({})])).resolves.toEqual([
      { runId: "maintenance-run-7" },
      { runId: "maintenance-run-7" },
    ]);
    expect(scheduler.runNow).toHaveBeenCalledTimes(2);
  });

  it("rejects new manual maintenance after shutdown and drains accepted maintenance", async () => {
    const ipcMain = createFakeIpcMain();
    const maintenance = createDeferred<void>();
    const scheduler = {
      runNow: vi.fn(async () => "maintenance-run-8"),
      beginShutdown: vi.fn(() => maintenance.promise),
      pendingCount: () => 1,
    };
    const runtime = registerMemoryIpc({
      ipcMain,
      governance: createGovernance(),
      memoryScheduler: scheduler,
    });

    const shutdown = runtime.beginShutdown();
    await expect(handler(ipcMain, IPC_CHANNELS.memory.runMaintenance)({}))
      .rejects.toThrow("Memory IPC is shutting down");
    let finished = false;
    void shutdown.then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    maintenance.resolve();
    await expect(shutdown).resolves.toBeUndefined();
  });

  it("dispatches valid payloads to the matching governance methods", async () => {
    const ipcMain = createFakeIpcMain();
    const governance = createGovernance();
    registerMemoryIpc({ ipcMain, governance });

    await handler(ipcMain, IPC_CHANNELS.memory.getSnapshot)({});
    await handler(ipcMain, IPC_CHANNELS.memory.updateProfileField)({}, {
      layer: "L0",
      field: "preferredName",
      value: "Alex",
    });
    await handler(ipcMain, IPC_CHANNELS.memory.updateL2)({}, {
      id: "memory-1",
      content: "A safe memory",
    });
    await handler(ipcMain, IPC_CHANNELS.memory.deleteProfileField)({}, {
      layer: "L1",
      field: "recentGoals",
    });
    await handler(ipcMain, IPC_CHANNELS.memory.deleteL2)({}, "memory-1");
    await handler(ipcMain, IPC_CHANNELS.memory.setPinned)({}, {
      id: "memory-1",
      pinned: true,
    });
    await handler(ipcMain, IPC_CHANNELS.memory.setEnabled)({}, {
      id: "memory-1",
      enabled: false,
    });
    await handler(ipcMain, IPC_CHANNELS.memory.restoreL2)({}, "memory-1");
    await handler(ipcMain, IPC_CHANNELS.memory.clearLayer)({}, "L2");
    await handler(ipcMain, IPC_CHANNELS.memory.getAuditReport)({});

    expect(governance.snapshot).toHaveBeenCalledOnce();
    expect(governance.updateProfileField).toHaveBeenCalledWith({
      layer: "L0",
      field: "preferredName",
      value: "Alex",
    });
    expect(governance.updateL2).toHaveBeenCalledWith({
      id: "memory-1",
      content: "A safe memory",
    });
    expect(governance.deleteProfileField).toHaveBeenCalledWith({
      layer: "L1",
      field: "recentGoals",
    });
    expect(governance.deleteL2).toHaveBeenCalledWith("memory-1");
    expect(governance.setL2Pinned).toHaveBeenCalledWith({ id: "memory-1", pinned: true });
    expect(governance.setL2Enabled).toHaveBeenCalledWith({ id: "memory-1", enabled: false });
    expect(governance.restoreL2).toHaveBeenCalledWith("memory-1");
    expect(governance.clearLayer).toHaveBeenCalledWith("L2");
    expect(governance.audit).toHaveBeenCalledOnce();
  });

  it("runs and tracks best-effort restored-memory inspection without exposing its failure", async () => {
    const ipcMain = createFakeIpcMain();
    const governance = createGovernance();
    const inspection = createDeferred<void>();
    const afterRestoreL2 = vi.fn(() => inspection.promise);
    vi.mocked(governance.restoreL2).mockResolvedValue({ ok: true, snapshot: {} } as never);
    const runtime = registerMemoryIpc({ ipcMain, governance, afterRestoreL2 });

    const restore = handler(ipcMain, IPC_CHANNELS.memory.restoreL2)({}, "memory-1");
    await Promise.resolve();
    await Promise.resolve();
    const shutdown = runtime.beginShutdown();
    let shutdownFinished = false;
    void shutdown.then(() => { shutdownFinished = true; });

    expect(afterRestoreL2).toHaveBeenCalledWith("memory-1", {
      sender: undefined,
      runId: "memory_restore_1",
    });
    expect(shutdownFinished).toBe(false);
    inspection.resolve();
    await expect(restore).resolves.toEqual({ ok: true, snapshot: { kind: "snapshot" } });
    await expect(shutdown).resolves.toBeUndefined();

    const failureIpcMain = createFakeIpcMain();
    const failedInspection = vi.fn(async () => {
      throw new Error("private inspection detail");
    });
    registerMemoryIpc({ ipcMain: failureIpcMain, governance, afterRestoreL2: failedInspection });
    await expect(handler(failureIpcMain, IPC_CHANNELS.memory.restoreL2)({}, "memory-1"))
      .resolves.toEqual({ ok: true, snapshot: { kind: "snapshot" } });
  });

  it("passes restore IPC sender context to inspection and returns the post-inspection snapshot", async () => {
    const ipcMain = createFakeIpcMain();
    const governance = createGovernance();
    const sender = { send: vi.fn() };
    const restoredSnapshot = { kind: "restored-snapshot" };
    vi.mocked(governance.restoreL2).mockResolvedValue({ ok: true, snapshot: { kind: "before-inspection" } } as never);
    vi.mocked(governance.snapshot).mockResolvedValue(restoredSnapshot as never);
    const afterRestoreL2 = vi.fn(async () => undefined);
    registerMemoryIpc({ ipcMain, governance, afterRestoreL2 });

    const result = await handler(ipcMain, IPC_CHANNELS.memory.restoreL2)({ sender }, "memory-1");

    expect(afterRestoreL2).toHaveBeenCalledWith(
      "memory-1",
      expect.objectContaining({ sender, runId: "memory_restore_1" }),
    );
    expect(result).toEqual({ ok: true, snapshot: restoredSnapshot });
    expect(governance.snapshot).toHaveBeenCalledOnce();
  });

  it.each([
    ["snapshot payload", IPC_CHANNELS.memory.getSnapshot, { unexpected: true }],
    ["profile array", IPC_CHANNELS.memory.updateProfileField, []],
    ["profile layer", IPC_CHANNELS.memory.updateProfileField, { layer: "L2", field: "preferredName", value: "Alex" }],
    ["profile field", IPC_CHANNELS.memory.updateProfileField, { layer: "L0", field: "recentGoals", value: ["ship"] }],
    ["profile scalar content", IPC_CHANNELS.memory.updateProfileField, { layer: "L0", field: "preferredName", value: "   " }],
    ["profile array content", IPC_CHANNELS.memory.updateProfileField, { layer: "L1", field: "recentGoals", value: ["ship", 7] }],
    ["profile sparse array", IPC_CHANNELS.memory.updateProfileField, { layer: "L1", field: "recentGoals", value: new Array(1) }],
    ["profile extra field", IPC_CHANNELS.memory.updateProfileField, { layer: "L0", field: "preferredName", value: "Alex", admin: true }],
    ["L2 id", IPC_CHANNELS.memory.updateL2, { id: " ", content: "safe" }],
    ["L2 content", IPC_CHANNELS.memory.updateL2, { id: "memory-1", content: 7 }],
    ["L2 empty content", IPC_CHANNELS.memory.updateL2, { id: "memory-1", content: "  " }],
    ["delete profile layer", IPC_CHANNELS.memory.deleteProfileField, { layer: "L2", field: "recentGoals" }],
    ["delete id", IPC_CHANNELS.memory.deleteL2, ""],
    ["pin boolean", IPC_CHANNELS.memory.setPinned, { id: "memory-1", pinned: "yes" }],
    ["enable boolean", IPC_CHANNELS.memory.setEnabled, { id: "memory-1", enabled: 1 }],
    ["restore id shape", IPC_CHANNELS.memory.restoreL2, { id: "memory-1" }],
    ["clear layer", IPC_CHANNELS.memory.clearLayer, "ALL"],
    ["audit payload", IPC_CHANNELS.memory.getAuditReport, null],
  ])("rejects malformed %s before governance invocation", async (_name, channel, payload) => {
    const ipcMain = createFakeIpcMain();
    const governance = createGovernance();
    registerMemoryIpc({ ipcMain, governance });

    await expect(handler(ipcMain, channel)({}, payload)).rejects.toThrow(
      "Invalid memory IPC payload",
    );
    for (const method of Object.values(governance)) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it("rejects inherited and prototype-pollution payload properties", async () => {
    const ipcMain = createFakeIpcMain();
    const governance = createGovernance();
    registerMemoryIpc({ ipcMain, governance });
    const inherited = Object.create({ id: "memory-1", content: "unsafe" });
    const polluted = JSON.parse(
      '{"id":"memory-1","content":"safe","__proto__":{"polluted":true}}',
    ) as unknown;

    await expect(
      handler(ipcMain, IPC_CHANNELS.memory.updateL2)({}, inherited),
    ).rejects.toThrow("Invalid memory IPC payload");
    await expect(
      handler(ipcMain, IPC_CHANNELS.memory.updateL2)({}, polluted),
    ).rejects.toThrow("Invalid memory IPC payload");
    expect(governance.updateL2).not.toHaveBeenCalled();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("maps parser-internal failures to the fixed invalid-payload error", async () => {
    const ipcMain = createFakeIpcMain();
    const governance = createGovernance();
    registerMemoryIpc({ ipcMain, governance });
    const hostile = new Proxy({}, {
      getPrototypeOf: () => {
        throw new Error("C:\\private\\memory.json");
      },
    });

    const operation = handler(ipcMain, IPC_CHANNELS.memory.updateL2)({}, hostile);

    await expect(operation).rejects.toThrow("Invalid memory IPC payload");
    await expect(operation).rejects.not.toThrow("memory.json");
    expect(governance.updateL2).not.toHaveBeenCalled();
  });

  it("redacts governance exceptions behind a fixed error", async () => {
    const ipcMain = createFakeIpcMain();
    const governance = createGovernance();
    vi.mocked(governance.updateL2).mockRejectedValueOnce(
      new Error("C:\\Users\\Alex\\memory.json contains private content"),
    );
    registerMemoryIpc({ ipcMain, governance });

    const operation = handler(ipcMain, IPC_CHANNELS.memory.updateL2)({}, {
      id: "memory-1",
      content: "A safe replacement",
    });

    await expect(operation).rejects.toThrow("Memory operation failed");
    await expect(operation).rejects.not.toThrow("memory.json");
    await expect(operation).rejects.not.toThrow("private content");
  });

  it("waits for every accepted operation, including rejected operations", async () => {
    const ipcMain = createFakeIpcMain();
    const governance = createGovernance();
    const first = createDeferred<never>();
    const second = createDeferred<never>();
    vi.mocked(governance.snapshot)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const runtime = registerMemoryIpc({ ipcMain, governance });
    const getSnapshot = handler(ipcMain, IPC_CHANNELS.memory.getSnapshot);
    const firstOperation = getSnapshot({});
    const secondOperation = getSnapshot({});
    const shutdown = runtime.beginShutdown();
    let shutdownFinished = false;
    void shutdown.then(() => {
      shutdownFinished = true;
    });

    first.reject(new Error("accepted failure"));
    await expect(firstOperation).rejects.toThrow("Memory operation failed");
    await Promise.resolve();
    expect(shutdownFinished).toBe(false);
    expect(runtime.pendingOperationCount()).toBe(1);

    second.reject(new Error("another accepted failure"));
    await expect(secondOperation).rejects.toThrow("Memory operation failed");
    await expect(shutdown).resolves.toBeUndefined();
    expect(runtime.pendingOperationCount()).toBe(0);
  });

  it("rejects operations accepted after shutdown begins", async () => {
    const ipcMain = createFakeIpcMain();
    const governance = createGovernance();
    const runtime = registerMemoryIpc({ ipcMain, governance });

    await runtime.beginShutdown();

    await expect(
      handler(ipcMain, IPC_CHANNELS.memory.getSnapshot)({}),
    ).rejects.toThrow("Memory IPC is shutting down");
    expect(governance.snapshot).not.toHaveBeenCalled();
  });

  it("disposes handlers idempotently without an old runtime removing a replacement", () => {
    const ipcMain = createFakeIpcMain();
    const first = registerMemoryIpc({ ipcMain, governance: createGovernance() });
    const second = registerMemoryIpc({ ipcMain, governance: createGovernance() });
    const removalsAfterReplacement = ipcMain.removedChannels.length;

    first.dispose();
    expect(ipcMain.handlers.size).toBe(memoryChannels().length);
    expect(ipcMain.removedChannels).toHaveLength(removalsAfterReplacement);

    second.dispose();
    second.dispose();
    expect(ipcMain.handlers.size).toBe(0);
    expect(ipcMain.removedChannels).toHaveLength(
      removalsAfterReplacement + memoryChannels().length,
    );
  });

  it("closes the old acceptance gate when a registration is replaced", async () => {
    const ipcMain = createFakeIpcMain();
    const oldGovernance = createGovernance();
    registerMemoryIpc({ ipcMain, governance: oldGovernance });
    const retainedOldHandler = handler(ipcMain, IPC_CHANNELS.memory.getSnapshot);

    registerMemoryIpc({ ipcMain, governance: createGovernance() });

    await expect(retainedOldHandler({})).rejects.toThrow("Memory IPC is shutting down");
    expect(oldGovernance.snapshot).not.toHaveBeenCalled();
  });

  it("closes the acceptance gate when the active registration is disposed", async () => {
    const ipcMain = createFakeIpcMain();
    const governance = createGovernance();
    const runtime = registerMemoryIpc({ ipcMain, governance });
    const retainedHandler = handler(ipcMain, IPC_CHANNELS.memory.getSnapshot);

    runtime.dispose();

    await expect(retainedHandler({})).rejects.toThrow("Memory IPC is shutting down");
    expect(governance.snapshot).not.toHaveBeenCalled();
  });
});

describe("combineIpcShutdownRuntimes", () => {
  it("includes MCP pending work and shutdown in the combined runtime", async () => {
    const chatRuntime: ChatIpcRuntime = {
      beginShutdown: vi.fn(async () => undefined),
      flushBackgroundTasks: vi.fn(async () => undefined),
      pendingBackgroundTaskCount: () => 1,
    };
    const memoryRuntime: MemoryIpcRuntime = {
      beginShutdown: vi.fn(async () => undefined),
      pendingOperationCount: () => 1,
      dispose: vi.fn(),
    };
    const mcpRuntime = {
      shutdown: vi.fn(async () => undefined),
      pendingBackgroundTaskCount: vi.fn(() => 2),
    };
    const combined = combineIpcShutdownRuntimes(chatRuntime, memoryRuntime, mcpRuntime);

    expect(combined.pendingBackgroundTaskCount()).toBe(
      chatRuntime.pendingBackgroundTaskCount() + memoryRuntime.pendingOperationCount() + 2,
    );
    await combined.beginShutdown();
    expect(mcpRuntime.shutdown).toHaveBeenCalledOnce();
  });
  it("stops and counts scheduled task work during combined shutdown", async () => {
    const chatRuntime = { beginShutdown: vi.fn(async () => undefined), flushBackgroundTasks: vi.fn(async () => undefined), pendingBackgroundTaskCount: () => 0 };
    const memoryRuntime = { beginShutdown: vi.fn(async () => undefined), pendingOperationCount: () => 0, dispose: vi.fn() };
    const schedulerRuntime = { beginShutdown: vi.fn(async () => undefined), pendingCount: vi.fn(() => 3) };
    const combined = combineIpcShutdownRuntimes(chatRuntime, memoryRuntime, undefined, schedulerRuntime);
    expect(combined.pendingBackgroundTaskCount()).toBe(3);
    await combined.beginShutdown();
    expect(schedulerRuntime.beginShutdown).toHaveBeenCalledOnce();
  });
  it("drains accepted chat and resolver work before shutting down maintenance", async () => {
    const calls: string[] = [];
    const chatRuntime: ChatIpcRuntime = {
      closeAcceptance: vi.fn(async () => { calls.push("chat-acceptance"); }),
      beginShutdown: vi.fn(async () => { calls.push("chat-and-resolver-drain"); }),
      flushBackgroundTasks: vi.fn(async () => undefined),
      pendingBackgroundTaskCount: () => 1,
    };
    const memoryRuntime: MemoryIpcRuntime = {
      closeAcceptance: vi.fn(async () => { calls.push("memory-acceptance"); }),
      beginShutdown: vi.fn(async () => { calls.push("maintenance-drain"); }),
      pendingOperationCount: () => 1,
      dispose: vi.fn(),
    };

    await combineIpcShutdownRuntimes(chatRuntime, memoryRuntime).beginShutdown();

    expect(calls.slice(0, 2).sort()).toEqual(["chat-acceptance", "memory-acceptance"]);
    expect(calls.slice(2)).toEqual(["chat-and-resolver-drain", "maintenance-drain"]);
  });

  it("closes both acceptance gates before waiting for restore scheduling and the final resolver tail", async () => {
    const restoreScheduling = createDeferred<void>();
    const resolverTail = createDeferred<void>();
    let chatAccepting = true;
    let memoryAccepting = true;
    const chatRuntime: ChatIpcRuntime = {
      closeAcceptance: vi.fn(async () => {
        chatAccepting = false;
      }),
      beginShutdown: vi.fn(() => resolverTail.promise),
      flushBackgroundTasks: vi.fn(() => resolverTail.promise),
      pendingBackgroundTaskCount: () => 1,
    };
    const memoryRuntime: MemoryIpcRuntime = {
      beginShutdown: vi.fn(() => {
        memoryAccepting = false;
        return restoreScheduling.promise;
      }),
      pendingOperationCount: () => 1,
      dispose: vi.fn(),
    };
    const combined = combineIpcShutdownRuntimes(chatRuntime, memoryRuntime);

    const shutdown = combined.beginShutdown();
    expect(chatRuntime.closeAcceptance).toHaveBeenCalledOnce();
    expect(memoryRuntime.beginShutdown).toHaveBeenCalledOnce();
    expect(chatAccepting).toBe(false);
    expect(memoryAccepting).toBe(false);
    expect(chatRuntime.beginShutdown).not.toHaveBeenCalled();

    restoreScheduling.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(chatRuntime.beginShutdown).toHaveBeenCalledOnce();
    let finished = false;
    void shutdown.then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);

    resolverTail.resolve();
    await expect(shutdown).resolves.toBeUndefined();
  });

  it("starts both gates once and waits for both runtimes before rejecting safely", async () => {
    const memoryShutdown = createDeferred<void>();
    const chatRuntime: ChatIpcRuntime = {
      beginShutdown: vi.fn(async () => {
        throw new Error("C:\\private\\chat-state.json");
      }),
      flushBackgroundTasks: vi.fn(async () => undefined),
      pendingBackgroundTaskCount: () => 2,
    };
    const memoryRuntime: MemoryIpcRuntime = {
      beginShutdown: vi.fn(() => memoryShutdown.promise),
      pendingOperationCount: () => 3,
      dispose: vi.fn(),
    };
    const combined = combineIpcShutdownRuntimes(chatRuntime, memoryRuntime);

    expect(combined.pendingBackgroundTaskCount()).toBe(5);
    const shutdown = combined.beginShutdown();
    expect(chatRuntime.beginShutdown).toHaveBeenCalledOnce();
    expect(memoryRuntime.beginShutdown).toHaveBeenCalledOnce();
    expect(combined.beginShutdown()).toBe(shutdown);
    expect(combined.flushBackgroundTasks()).toBe(shutdown);

    let finished = false;
    void shutdown.catch(() => undefined).then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);

    memoryShutdown.resolve();
    await expect(shutdown).rejects.toThrow("Background shutdown failed");
    await expect(shutdown).rejects.not.toThrow("chat-state.json");
    expect(chatRuntime.beginShutdown).toHaveBeenCalledOnce();
    expect(memoryRuntime.beginShutdown).toHaveBeenCalledOnce();
  });
});
