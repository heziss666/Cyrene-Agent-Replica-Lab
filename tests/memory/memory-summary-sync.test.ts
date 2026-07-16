import { describe, expect, it, vi } from "vitest";
import { MemorySummarySync } from "../../src/main/memory/memory-summary-sync.js";
import { createEmptyMemoryFileV2, type L2MemoryV2, type MemoryFile } from "../../src/main/memory/memory-types.js";

describe("MemorySummarySync", () => {
  it("syncs vector before enabling summary and merging sources", async () => {
    const fixture = createFixture();
    await expect(fixture.sync.syncPendingSummary("s1")).resolves.toEqual({ summaryId: "s1", status: "synced" });
    expect(fixture.order).toEqual(["embed", "index", "final-store"]);
    expect(fixture.file.l2.find(({ id }) => id === "s1")).toMatchObject({ isEnabled: true, syncStatus: "synced" });
    expect(fixture.file.l2.filter(({ id }) => id.startsWith("m")).every(({ status, mergedInto }) => status === "merged" && mergedInto === "s1")).toBe(true);
  });
  it("marks failed sync disabled and leaves sources active", async () => {
    const fixture = createFixture({ embedFails: true });
    await expect(fixture.sync.syncPendingSummary("s1")).resolves.toMatchObject({ status: "failed" });
    expect(fixture.file.l2.find(({ id }) => id === "s1")).toMatchObject({ isEnabled: false, syncStatus: "sync_failed" });
    expect(fixture.file.l2.filter(({ id }) => id.startsWith("m")).every(({ status }) => status === "active")).toBe(true);
  });
  it("refuses stale sources without changing originals", async () => {
    const fixture = createFixture(); fixture.file.l2[0].updatedAt = "2026-08-01T00:00:00.000Z";
    await expect(fixture.sync.syncPendingSummary("s1")).resolves.toMatchObject({ status: "stale" });
    expect(fixture.file.l2[0].status).toBe("active"); expect(fixture.addMany).not.toHaveBeenCalled();
  });
  it("retries failed summaries without a compressor", async () => {
    const fixture = createFixture(); fixture.file.l2.find(({ id }) => id === "s1")!.syncStatus = "sync_failed";
    await expect(fixture.sync.retryPendingSummarySync()).resolves.toEqual([{ summaryId: "s1", status: "synced" }]);
    expect(fixture.embed).toHaveBeenCalledOnce();
  });
});

function createFixture(options: { embedFails?: boolean } = {}) {
  const file = createEmptyMemoryFileV2(); const order: string[] = []; const now = "2026-07-01T00:00:00.000Z";
  const source = (id: string): L2MemoryV2 => ({ id, content: id, confidence: 0.9, importance: "medium", evidenceIds: [], createdAt: now, updatedAt: now, lastAccessedAt: now, accessCount: 0, weight: 0.6, isPinned: false, isEnabled: true, status: "active", syncStatus: "synced", isSummary: false, sourceMemoryIds: [], sourceSnapshots: [], conflictWith: [] });
  file.l2.push(source("m1"), source("m2"), source("m3"));
  file.l2.push({ ...source("s1"), content: "summary", isSummary: true, isEnabled: false, syncStatus: "pending_sync", sourceMemoryIds: ["m1", "m2", "m3"], sourceSnapshots: ["m1", "m2", "m3"].map((memoryId) => ({ memoryId, updatedAt: now })) });
  let updateNumber = 0;
  const store = { load: async () => structuredClone(file), update: async (mutator: (draft: MemoryFile) => void) => { updateNumber++; if (updateNumber > 1 || !options.embedFails) order.push(updateNumber === 1 && options.embedFails ? "mark-failed" : "final-store"); mutator(file); return structuredClone(file); } };
  const embed = vi.fn(async () => { order.push("embed"); if (options.embedFails) throw new Error("offline"); return [[1, 0]]; });
  const addMany = vi.fn(async () => { order.push("index"); });
  const sync = new MemorySummarySync({ store, embeddingProvider: { id: "fake", model: "fake", embedDocuments: embed, embedQuery: async () => [1] }, vectorIndex: { initialize: async () => ({ status: "loaded", loadedEntries: 0 }), addMany, has: () => false, get: () => undefined, prune: async () => 0, clear: async () => undefined }, now: () => new Date(now), idFactory: () => "log1" });
  return { file, order, sync, embed, addMany };
}
