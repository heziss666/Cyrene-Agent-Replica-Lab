import { describe, expect, it, vi } from "vitest";
import { MemoryCompressionService } from "../../src/main/memory/memory-compression-service.js";
import { createEmptyMemoryFileV2, type L2MemoryV2, type MemoryFile } from "../../src/main/memory/memory-types.js";

describe("MemoryCompressionService", () => {
  it("persists a disabled pending summary before vector sync", async () => {
    const fixture = createFixture();
    await expect(fixture.service.compressEligibleMemories()).resolves.toMatchObject({ clusters: 1, compressed: 1, skipped: 0, summaryIds: ["summary1"] });
    expect(fixture.seenAtSync).toMatchObject({ isEnabled: false, syncStatus: "pending_sync", isSummary: true, sourceMemoryIds: ["m1", "m2", "m3"] });
    expect(fixture.file.evidence.at(-1)).toMatchObject({ source: "reflection", quote: "", sourceMemoryIds: ["m1", "m2", "m3"] });
  });
  it("leaves Store unchanged when compressor fails", async () => {
    const fixture = createFixture({ compressorFails: true }); const before = structuredClone(fixture.file);
    await expect(fixture.service.compressEligibleMemories()).resolves.toMatchObject({ compressed: 0, skipped: 1 });
    expect(fixture.file).toEqual(before);
  });
  it("leaves Store unchanged when verifier rejects", async () => {
    const fixture = createFixture({ verifierRejects: true }); const before = structuredClone(fixture.file);
    await fixture.service.compressEligibleMemories(); expect(fixture.file).toEqual(before);
  });
});

function createFixture(options: { compressorFails?: boolean; verifierRejects?: boolean } = {}) {
  const file = createEmptyMemoryFileV2(); const now = "2026-07-01T00:00:00.000Z";
  const memory = (id: string): L2MemoryV2 => ({ id, content: "related memory", confidence: 0.95, importance: "high", evidenceIds: [`e${id.slice(1)}`], createdAt: now, updatedAt: now, lastAccessedAt: now, accessCount: 0, weight: 0.8, isPinned: false, isEnabled: true, status: "active", syncStatus: "synced", isSummary: false, sourceMemoryIds: [], sourceSnapshots: [], conflictWith: [] });
  file.l2.push(memory("m1"), memory("m2"), memory("m3")); for (let i = 1; i <= 3; i++) file.evidence.push({ id: `e${i}`, memoryId: `m${i}`, quote: "related memory", capturedAt: now, source: "conversation", sourceMemoryIds: [] });
  const store = { load: async () => structuredClone(file), update: async (mutator: (draft: MemoryFile) => void) => { mutator(file); return structuredClone(file); } };
  let seenAtSync: L2MemoryV2 | undefined; const ids = ["summary1", "summary-evidence"];
  const service = new MemoryCompressionService({ store, embeddingProvider: { id: "fake", model: "fake", embedDocuments: async (texts) => texts.map(() => [1, 0]), embedQuery: async () => [1, 0] }, compressor: { compressCluster: async (input) => { if (options.compressorFails) throw new Error("bad model"); return { summary: "related summary", sourceMemoryIds: [...input.cluster], sourceSnapshots: input.sources.map(({ id, updatedAt }) => ({ memoryId: id, updatedAt })), evidenceIds: ["e1", "e2", "e3"], claims: [{ text: "related", evidenceIds: ["e1"] }], confidence: 0.95, importance: "high", reason: "related" }; } }, verifier: { verify: async () => ({ supported: !options.verifierRejects, confidence: 0.95, claims: [{ claimIndex: 0, supported: true, evidenceIds: ["e1"] }], reason: "ok" }) }, summarySync: { syncPendingSummary: vi.fn(async (id) => { seenAtSync = structuredClone(file.l2.find((item) => item.id === id)); return { summaryId: id, status: "synced" as const }; }) }, now: () => new Date(now), idFactory: () => ids.shift()! });
  return { file, service, get seenAtSync() { return seenAtSync; } };
}
