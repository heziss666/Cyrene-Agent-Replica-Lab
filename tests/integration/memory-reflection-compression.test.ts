import { describe, expect, it, vi } from "vitest";
import { MemoryIntelligenceService } from "../../src/main/memory/memory-intelligence-service.js";
import { MemoryProfilePromoter } from "../../src/main/memory/memory-profile-promoter.js";
import { MemoryCompressionService } from "../../src/main/memory/memory-compression-service.js";
import { MemorySummarySync } from "../../src/main/memory/memory-summary-sync.js";
import { EntityGraphService } from "../../src/main/memory/entity-graph.js";
import { auditMemoryFile } from "../../src/main/memory/memory-audit.js";
import { createEmptyMemoryFileV2, type L2MemoryV2, type MemoryFile } from "../../src/main/memory/memory-types.js";
import type { MemoryStore } from "../../src/main/memory/memory-store.js";

describe("reflection and compression integration", () => {
  it("promotes, compresses, synchronizes, merges, rebuilds graph, and remains idempotent", async () => {
    const fixture = createFixture();
    await expect(fixture.intelligence.reflectAndPromote()).resolves.toMatchObject({ proposedCount: 1, acceptedCount: 1 });
    await expect(fixture.intelligence.compress()).resolves.toMatchObject({ compressed: 1 });
    const graphSummary = await fixture.intelligence.rebuildEntityGraph();
    const summary = fixture.file.l2.find(({ isSummary }) => isSummary)!;
    expect(summary).toMatchObject({ isEnabled: true, syncStatus: "synced", status: "active" });
    expect(fixture.file.l2.filter(({ isSummary }) => !isSummary).every(({ status, mergedInto }) => status === "merged" && mergedInto === summary.id)).toBe(true);
    expect(graphSummary).toEqual({ nodeCount: 2, relationCount: 1 });
    expect(fixture.graph.snapshot().nodes.every(({ sourceMemoryIds }) => sourceMemoryIds.includes(summary.id))).toBe(true);
    expect(auditMemoryFile(fixture.file)).toEqual({ ok: true, findings: [] });
    await expect(fixture.intelligence.compress()).resolves.toMatchObject({ clusters: 0, compressed: 0 });
  });

  it("keeps original sources recallable when embeddings are offline", async () => {
    const fixture = createFixture({ offline: true });
    await expect(fixture.intelligence.compress()).rejects.toThrow("offline");
    expect(fixture.file.l2.every(({ status, isEnabled }) => status === "active" && isEnabled)).toBe(true);
  });

  it("does not mutate profile when reflection verification rejects", async () => {
    const fixture = createFixture({ rejectReflection: true });
    await expect(fixture.intelligence.reflectAndPromote()).resolves.toMatchObject({ acceptedCount: 0, skippedCount: 1 });
    expect(fixture.file.l0.occupation).toBeUndefined();
  });

  it("keeps the previous graph readable when graph persistence fails", async () => {
    const fixture = createFixture({ graphFails: true });
    await fixture.intelligence.reflectAndPromote();
    await expect(fixture.intelligence.rebuildEntityGraph()).rejects.toThrow("graph disk failure");
    expect(fixture.graph.snapshot().nodes).toEqual([]);
  });
});

const NOW = "2026-07-16T00:00:00.000Z";
function createFixture(options: { offline?: boolean; rejectReflection?: boolean; graphFails?: boolean } = {}) {
  const file = createEmptyMemoryFileV2();
  for (let day = 1; day <= 3; day++) {
    file.l2.push(memory(`m${day}`, day));
    file.evidence.push({ id: `e${day}`, memoryId: `m${day}`, quote: "I use TypeScript in Agent Lab", capturedAt: `2026-07-0${day}T00:00:00.000Z`, source: "conversation", sourceMemoryIds: [] });
  }
  const store: MemoryStore = { load: async () => structuredClone(file), update: async (mutator) => { mutator(file); return structuredClone(file); } };
  const embedDocuments = vi.fn(async (texts: string[]) => { if (options.offline) throw new Error("offline"); return texts.map(() => [1, 0]); });
  const embeddingProvider = { id: "fake", model: "fake", embedDocuments, embedQuery: async () => [1, 0] };
  const vectorIndex = { initialize: async () => ({ status: "loaded" as const, loadedEntries: 0 }), addMany: vi.fn(async () => undefined), has: () => false, get: () => undefined, prune: async () => 0, clear: async () => undefined };
  const summarySync = new MemorySummarySync({ store, embeddingProvider, vectorIndex, now: () => new Date(NOW), idFactory: () => "compression-log" });
  const compressionIds = ["summary-1", "summary-evidence-1"];
  const compression = new MemoryCompressionService({ store, embeddingProvider, compressor: { compressCluster: async (input) => ({ summary: "Uses TypeScript in Agent Lab", sourceMemoryIds: [...input.cluster], sourceSnapshots: input.sources.map(({ id, updatedAt }) => ({ memoryId: id, updatedAt })), evidenceIds: ["e1", "e2", "e3"], claims: [{ text: "Uses TypeScript in Agent Lab", evidenceIds: ["e1", "e2", "e3"] }], confidence: 0.95, importance: "high", reason: "repeated" }) }, verifier: { verify: async () => ({ supported: true, confidence: 0.95, claims: [{ claimIndex: 0, supported: true, evidenceIds: ["e1", "e2", "e3"] }], reason: "supported" }) }, summarySync, now: () => new Date(NOW), idFactory: () => compressionIds.shift()! });
  const graph = new EntityGraphService({ atomicWrite: async () => { if (options.graphFails) throw new Error("graph disk failure"); }, now: () => new Date(NOW) });
  const intelligence = new MemoryIntelligenceService({ store, reflection: { reflect: async (input) => ({ profileUpdates: [{ layer: "L0", field: "occupation", content: "developer", sourceMemoryIds: ["m1", "m2", "m3"], sourceSnapshots: input.sources.map(({ id, updatedAt }) => ({ memoryId: id, updatedAt })), claims: [{ text: "developer", evidenceIds: ["e1"] }], confidence: 0.95, reason: "repeated" }], entities: [{ type: "technology", name: "TypeScript", sourceMemoryIds: ["m1", "m2", "m3"] }, { type: "project", name: "Agent Lab", sourceMemoryIds: ["m1", "m2", "m3"] }], relations: [{ fromName: "TypeScript", toName: "Agent Lab", type: "used_in", sourceMemoryIds: ["m1", "m2", "m3"] }] }) }, verifier: { verify: async () => ({ supported: !options.rejectReflection, confidence: 0.95, claims: [{ claimIndex: 0, supported: true, evidenceIds: ["e1"] }], reason: "checked" }) }, promoter: new MemoryProfilePromoter({ store, now: () => new Date(NOW), idFactory: () => "promotion-log" }), compression, entityGraph: graph });
  return { file, graph, intelligence };
}
function memory(id: string, day: number): L2MemoryV2 { const timestamp = `2026-07-0${day}T00:00:00.000Z`; return { id, content: "I use TypeScript in Agent Lab", confidence: 0.95, importance: "high", evidenceIds: [`e${day}`], createdAt: timestamp, updatedAt: timestamp, lastAccessedAt: timestamp, accessCount: 0, weight: 0.8, isPinned: false, isEnabled: true, status: "active", syncStatus: "synced", isSummary: false, sourceMemoryIds: [], sourceSnapshots: [], conflictWith: [] }; }
