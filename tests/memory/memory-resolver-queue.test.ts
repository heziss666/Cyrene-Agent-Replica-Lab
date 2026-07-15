import { describe, expect, it } from "vitest";
import { createMemoryResolverQueue } from "../../src/main/memory/memory-resolver-queue.js";

function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe("createMemoryResolverQueue", () => {
  it("runs high, normal, then idle work in stable createdAt order", async () => { const queue = createMemoryResolverQueue(); const order: string[] = []; queue.schedule({ id: "idle", priority: "idle", createdAt: "2026-07-15T03:00:00.000Z", run: async () => { order.push("idle"); } }); queue.schedule({ id: "normal-late", priority: "normal", createdAt: "2026-07-15T02:00:00.000Z", run: async () => { order.push("normal-late"); } }); queue.schedule({ id: "high", priority: "high", createdAt: "2026-07-15T04:00:00.000Z", run: async () => { order.push("high"); } }); queue.schedule({ id: "normal-early", priority: "normal", createdAt: "2026-07-15T01:00:00.000Z", run: async () => { order.push("normal-early"); } }); await queue.flush(); expect(order).toEqual(["high", "normal-early", "normal-late", "idle"]); });

  it("retries model and parse failures at most twice then leaves memory application untouched", async () => { const queue = createMemoryResolverQueue(); let attempts = 0; let applied = 0; queue.schedule({ id: "retry", priority: "high", createdAt: TIME, run: async () => { attempts += 1; throw new Error("model response invalid"); }, onFinalFailure: async () => { applied += 1; } }); await queue.flush(); expect(attempts).toBe(3); expect(applied).toBe(1); });

  it("flush waits for work scheduled while the stable tail drains", async () => { const queue = createMemoryResolverQueue(); const first = deferred(); const second = deferred(); const order: string[] = []; queue.schedule({ id: "first", priority: "normal", createdAt: "2026-07-15T00:00:00.000Z", run: async () => { await first.promise; order.push("first"); } }); const flush = queue.flush(); queue.schedule({ id: "second", priority: "normal", createdAt: "2026-07-15T01:00:00.000Z", run: async () => { await second.promise; order.push("second"); } }); first.resolve(); await Promise.resolve(); second.resolve(); await flush; expect(order).toEqual(["first", "second"]); });
});

const TIME = "2026-07-15T00:00:00.000Z";
