import { describe, expect, it, vi } from "vitest";
import {
  MaintenanceCoordinator,
  type MaintenanceStepName,
} from "../../src/main/memory/memory-maintenance.js";
import type { MemoryStore } from "../../src/main/memory/memory-store.js";
import {
  createEmptyMemoryFileV2,
  type MemoryFile,
} from "../../src/main/memory/memory-types.js";

const NOW = new Date("2026-07-15T00:00:00.000Z");

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

function createHarness(overrides: Partial<Record<MaintenanceStepName, () => unknown>> = {}) {
  const calls: string[] = [];
  const store = createStore();
  const step = (name: MaintenanceStepName, value: unknown = { ok: true }) => vi.fn(async () => {
    calls.push(name);
    const override = overrides[name];
    return override ? override() : value;
  });
  const coordinator = new MaintenanceCoordinator({
    store,
    resolverQueue: { flush: async () => { await step("resolver-idle")(); } },
    decayService: { runDecay: step("decay") },
    l1ExpiryService: { expireL1: step("l1-expiry") },
    reflection: step("reflection"),
    compression: step("compression"),
    entityGraph: step("entity-graph"),
    audit: step("audit"),
    now: () => NOW,
    idFactory: () => "maintenance-audit",
  });
  return { calls, coordinator, store };
}

describe("MaintenanceCoordinator", () => {
  it("runs every configured stage in the fixed coordinator order", async () => {
    const { calls, coordinator, store } = createHarness();

    const result = await coordinator.runNow("manual");

    expect(calls).toEqual([
      "resolver-idle",
      "decay",
      "l1-expiry",
      "reflection",
      "compression",
      "entity-graph",
      "audit",
    ]);
    expect(result.errorCodes).toEqual([]);
    expect(store.read().maintenance).toEqual(expect.objectContaining({
      running: false,
      successfulWritesSinceMaintenance: 0,
      lastMaintenanceAt: NOW.toISOString(),
    }));
  });

  it("persists running only while the maintenance call is active", async () => {
    const store = createStore();
    const decay = deferred();
    const coordinator = new MaintenanceCoordinator({
      store,
      resolverQueue: { flush: vi.fn(async () => undefined) },
      decayService: { runDecay: vi.fn(() => decay.promise) },
      l1ExpiryService: { expireL1: vi.fn(async () => ({})) },
      audit: vi.fn(async () => ({})),
      now: () => NOW,
    });

    const running = coordinator.runNow("manual");
    await vi.waitFor(() => expect(store.read().maintenance.running).toBe(true));
    decay.resolve({});
    await running;

    expect(store.read().maintenance.running).toBe(false);
  });

  it("captures one fixed now and passes it to decay and L1 expiry", async () => {
    const store = createStore();
    const later = new Date(NOW.getTime() + 60_000);
    const now = vi.fn(() => NOW).mockReturnValueOnce(NOW).mockReturnValue(later);
    const runDecay = vi.fn(async (_at: Date) => ({}));
    const expireL1 = vi.fn(async (_at: Date) => ({}));
    const coordinator = new MaintenanceCoordinator({
      store,
      resolverQueue: { flush: vi.fn(async () => undefined) },
      decayService: { runDecay },
      l1ExpiryService: { expireL1 },
      audit: vi.fn(async () => ({})),
      now,
      idFactory: () => "run-audit",
    });

    await coordinator.runNow("manual");

    expect(now).toHaveBeenCalledOnce();
    expect(runDecay).toHaveBeenCalledWith(NOW);
    expect(expireL1).toHaveBeenCalledWith(NOW);
    expect(runDecay.mock.calls[0]?.[0]).toBe(expireL1.mock.calls[0]?.[0]);
    expect(store.read().maintenance.lastMaintenanceAt).toBe(NOW.toISOString());
  });

  it("always clears running when final audit ID generation throws", async () => {
    const store = createStore();
    const coordinator = new MaintenanceCoordinator({
      store,
      resolverQueue: { flush: vi.fn(async () => undefined) },
      decayService: { runDecay: vi.fn(async () => ({})) },
      l1ExpiryService: { expireL1: vi.fn(async () => ({})) },
      audit: vi.fn(async () => ({})),
      now: () => NOW,
      idFactory: () => { throw new Error("ID source unavailable"); },
    });

    await expect(coordinator.runNow("manual")).resolves.toEqual(expect.objectContaining({
      errorCodes: [],
    }));

    expect(store.read().maintenance.running).toBe(false);
    expect(store.read().maintenance.lastMaintenanceAt).toBe(NOW.toISOString());
    expect(store.read().auditLogs.at(-1)).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^maintenance-audit-fallback-/),
      operation: "run_maintenance",
    }));
  });

  it("records absent future stages as not configured", async () => {
    const store = createStore();
    const coordinator = new MaintenanceCoordinator({
      store,
      resolverQueue: { flush: vi.fn(async () => undefined) },
      decayService: { runDecay: vi.fn(async () => ({ weightUpdated: 0 })) },
      l1ExpiryService: { expireL1: vi.fn(async () => ({ expiredFields: [] })) },
      audit: vi.fn(async () => ({ ok: true })),
      now: () => NOW,
    });

    const result = await coordinator.runNow("time");

    expect(result.steps.reflection).toEqual({ skipped: true, reason: "not_configured" });
    expect(result.steps.compression).toEqual({ skipped: true, reason: "not_configured" });
    expect(result.steps["entity-graph"]).toEqual({ skipped: true, reason: "not_configured" });
  });

  it("continues after resolver failure without storing sensitive exception text", async () => {
    const { calls, coordinator, store } = createHarness({
      "resolver-idle": () => { throw new Error("private resolver payload"); },
    });

    const result = await coordinator.runNow("write_count");

    expect(calls).toEqual([
      "resolver-idle", "decay", "l1-expiry", "reflection", "compression", "entity-graph", "audit",
    ]);
    expect(result.steps["resolver-idle"]).toEqual({
      failed: true,
      code: "MEMORY_MAINTENANCE_RESOLVER_FAILED",
    });
    expect(store.read().maintenance.lastErrorCode).toBe("MEMORY_MAINTENANCE_RESOLVER_FAILED");
    expect(JSON.stringify(store.read())).not.toContain("private resolver payload");
  });

  it("stops destructive stages after decay failure but always audits", async () => {
    const { calls, coordinator } = createHarness({
      decay: () => { throw new Error("sensitive decay details"); },
    });

    const result = await coordinator.runNow("manual");

    expect(calls).toEqual(["resolver-idle", "decay", "audit"]);
    expect(result.steps.decay).toEqual({
      failed: true,
      code: "MEMORY_MAINTENANCE_DECAY_FAILED",
    });
    expect(result.steps["l1-expiry"]).toEqual({ skipped: true, reason: "dependency_failed" });
    expect(result.steps.reflection).toEqual({ skipped: true, reason: "dependency_failed" });
  });

  it("skips compression after reflection failure and still runs entity graph and audit", async () => {
    const { calls, coordinator } = createHarness({
      reflection: () => { throw new Error("sensitive reflection details"); },
    });

    const result = await coordinator.runNow("manual");

    expect(calls).toEqual([
      "resolver-idle", "decay", "l1-expiry", "reflection", "entity-graph", "audit",
    ]);
    expect(result.steps.compression).toEqual({ skipped: true, reason: "dependency_failed" });
    expect(result.errorCodes).toContain("MEMORY_MAINTENANCE_REFLECTION_FAILED");
  });

  it("clears stale running state on startup with one metadata-only recovery audit", async () => {
    const initial = createEmptyMemoryFileV2();
    initial.maintenance.running = true;
    const store = createStore(initial);
    const coordinator = new MaintenanceCoordinator({
      store,
      resolverQueue: { flush: vi.fn(async () => undefined) },
      decayService: { runDecay: vi.fn(async () => ({})) },
      l1ExpiryService: { expireL1: vi.fn(async () => ({})) },
      audit: vi.fn(async () => ({})),
      now: () => NOW,
      idFactory: () => "recovery-audit",
    });

    await coordinator.initialize();

    expect(store.read().maintenance.running).toBe(false);
    expect(store.read().maintenance.lastErrorCode).toBe("MEMORY_MAINTENANCE_STALE_RUNNING_RECOVERED");
    expect(store.read().auditLogs).toEqual([{
      id: "recovery-audit",
      createdAt: NOW.toISOString(),
      operation: "recover_maintenance",
      targetType: "maintenance",
      source: "system",
      result: "success",
      code: "MEMORY_MAINTENANCE_STALE_RUNNING_RECOVERED",
    }]);
  });
});

function deferred<T = unknown>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
