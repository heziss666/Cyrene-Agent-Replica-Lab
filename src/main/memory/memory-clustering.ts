import { cosineSimilarity, validateVector } from "../rag/vector-math.js";
import type { L2MemoryV2, MemoryFile } from "./memory-types.js";

export interface MemoryCluster { memoryIds: string[]; centroid: number[] }

export function eligibleCompressionMemories(file: MemoryFile): L2MemoryV2[] {
  const unresolved = new Set(file.conflictLogs
    .filter((log) => log.resolutionType === "direct_conflict" && log.status !== "resolved")
    .flatMap((log) => [log.sourceMemoryId, log.targetMemoryId]));
  return file.l2.filter((memory) => memory.isEnabled && !memory.isPinned && !memory.isSummary
    && (memory.status === "active" || memory.status === "aging") && memory.syncStatus === "synced"
    && !unresolved.has(memory.id) && !memory.conflictWith.some((id) => unresolved.has(id) || unresolved.has(memory.id)));
}

export function clusterMemories(
  memories: readonly L2MemoryV2[],
  vectors: ReadonlyMap<string, number[]>,
  options: { similarityThreshold?: number; minimumSize?: number } = {},
): MemoryCluster[] {
  const ordered = [...memories].sort((a, b) => a.id.localeCompare(b.id));
  const selected = ordered.map(({ id }) => {
    const vector = vectors.get(id);
    if (!vector) throw new Error(`Missing vector for memory ${id}`);
    validateVector(vector, `Vector ${id}`);
    return vector;
  });
  if (selected.some((vector) => vector.length !== selected[0]?.length)) throw new Error("Vector dimensions must match");
  const parent = ordered.map((_, index) => index);
  const root = (index: number): number => parent[index] === index ? index : (parent[index] = root(parent[index]));
  const unite = (left: number, right: number) => { const a = root(left); const b = root(right); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  const threshold = options.similarityThreshold ?? 0.82;
  for (let left = 0; left < ordered.length; left++) for (let right = left + 1; right < ordered.length; right++) {
    if (cosineSimilarity(selected[left], selected[right]) >= threshold) unite(left, right);
  }
  const groups = new Map<number, number[]>();
  ordered.forEach((_, index) => groups.set(root(index), [...(groups.get(root(index)) ?? []), index]));
  return [...groups.values()].filter((indices) => indices.length >= (options.minimumSize ?? 3)).map((indices) => ({
    memoryIds: indices.map((index) => ordered[index].id),
    centroid: selected[0].map((_, dimension) => indices.reduce((sum, index) => sum + selected[index][dimension], 0) / indices.length),
  })).sort((a, b) => a.memoryIds[0].localeCompare(b.memoryIds[0]));
}
