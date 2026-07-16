import { describe, expect, it } from "vitest";
import { clusterMemories, eligibleCompressionMemories } from "../../src/main/memory/memory-clustering.js";
import { createEmptyMemoryFileV2, type L2MemoryV2 } from "../../src/main/memory/memory-types.js";

describe("memory clustering", () => {
  it("filters compression eligibility", () => {
    const file = createEmptyMemoryFileV2();
    file.l2 = [memory("ok"), memory("pinned", { isPinned: true }), memory("disabled", { isEnabled: false }), memory("summary", { isSummary: true }), memory("archived", { status: "archived" }), memory("pending", { syncStatus: "pending_sync" }), memory("conflict", { conflictWith: ["other"] })];
    file.conflictLogs.push({ id: "c1", sourceMemoryId: "conflict", targetMemoryId: "other", createdAt: NOW, status: "uncertain", score: 0.8, priority: "normal", attempts: 1, signals: {}, resolutionType: "direct_conflict" });
    expect(eligibleCompressionMemories(file).map(({ id }) => id)).toEqual(["ok"]);
  });

  it("forms deterministic connected components and centroids", () => {
    const memories = [memory("c"), memory("a"), memory("b"), memory("z")];
    const x = 0.13 / Math.sqrt(0.19);
    const vectors = new Map<string, number[]>([["a", [1, 0, 0]], ["b", [0.9, Math.sqrt(0.19), 0]], ["c", [0.8, x, Math.sqrt(1 - 0.64 - x * x)]], ["z", [0, 0, 1]]]);
    const clusters = clusterMemories(memories, vectors, { similarityThreshold: 0.82, minimumSize: 3 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memoryIds).toEqual(["a", "b", "c"]);
    expect(clusters[0].centroid).toHaveLength(3);
  });

  it("sorts clusters and assigns each memory once", () => {
    const memories = ["d", "e", "f", "a", "b", "c"].map((id) => memory(id));
    const vectors = new Map(memories.map(({ id }, index) => [id, index < 3 ? [0, 1] : [1, 0]]));
    expect(clusterMemories(memories, vectors, { similarityThreshold: 0.9 }).map(({ memoryIds }) => memoryIds)).toEqual([["a", "b", "c"], ["d", "e", "f"]]);
  });

  it.each([
    ["non-finite", new Map([["a", [1, Number.NaN]], ["b", [1, 0]], ["c", [1, 0]]])],
    ["dimension mismatch", new Map([["a", [1]], ["b", [1, 0]], ["c", [1, 0]]])],
  ])("rejects %s vectors before clustering", (_name, vectors) => {
    expect(() => clusterMemories([memory("a"), memory("b"), memory("c")], vectors)).toThrow();
  });
});

const NOW = "2026-07-01T00:00:00.000Z";
function memory(id: string, override: Partial<L2MemoryV2> = {}): L2MemoryV2 {
  return { id, content: id, confidence: 0.9, importance: "medium", evidenceIds: [], createdAt: NOW, updatedAt: NOW, lastAccessedAt: NOW, accessCount: 0, weight: 0.6, isPinned: false, isEnabled: true, status: "active", syncStatus: "synced", isSummary: false, sourceMemoryIds: [], sourceSnapshots: [], conflictWith: [], ...override };
}
