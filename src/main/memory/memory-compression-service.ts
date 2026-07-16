import { randomUUID } from "node:crypto";
import type { EmbeddingProvider } from "../rag/embedding-provider.js";
import { clusterMemories, eligibleCompressionMemories } from "./memory-clustering.js";
import type { CompressionInput, CompressionProposal, CompressionVerificationInput } from "./memory-compressor.js";
import type { ReflectionVerification } from "./memory-reflection-types.js";
import type { MemoryStore } from "./memory-store.js";
import { initialMemoryWeight } from "./memory-types.js";
import type { MemorySummarySync } from "./memory-summary-sync.js";

export interface CompressionRunSummary { clusters: number; compressed: number; skipped: number; summaryIds: string[] }
export class MemoryCompressionService {
  constructor(private readonly options: { store: MemoryStore; embeddingProvider: EmbeddingProvider; compressor: { compressCluster(input: CompressionInput): Promise<CompressionProposal> }; verifier: { verify(input: CompressionVerificationInput): Promise<ReflectionVerification> }; summarySync: Pick<MemorySummarySync, "syncPendingSummary">; now?: () => Date; idFactory?: () => string }) {}
  async compressEligibleMemories(): Promise<CompressionRunSummary> {
    const file = await this.options.store.load();
    const eligible = eligibleCompressionMemories(file);
    if (eligible.length < 3) return { clusters: 0, compressed: 0, skipped: 0, summaryIds: [] };
    const vectors = await this.options.embeddingProvider.embedDocuments(eligible.map(({ content }) => content));
    const clusters = clusterMemories(eligible, new Map(eligible.map((memory, index) => [memory.id, vectors[index]])));
    const result: CompressionRunSummary = { clusters: clusters.length, compressed: 0, skipped: 0, summaryIds: [] };
    for (const cluster of clusters) {
      const current = await this.options.store.load();
      const sourceRecords = cluster.memoryIds.map((id) => current.l2.find((memory) => memory.id === id)).filter((memory): memory is NonNullable<typeof memory> => Boolean(memory));
      const input: CompressionInput = { cluster: [...cluster.memoryIds], sources: sourceRecords.map(({ id, content, updatedAt }) => ({ id, content, updatedAt })), evidence: current.evidence.filter(({ memoryId }) => cluster.memoryIds.includes(memoryId)).map(({ id, memoryId, quote }) => ({ id, memoryId, quote })) };
      try {
        const proposal = await this.options.compressor.compressCluster(input);
        const verification = await this.options.verifier.verify({ proposal, sources: input.sources, evidence: input.evidence });
        if (!verification.supported) { result.skipped++; continue; }
        const summaryId = await this.persistPending(proposal);
        result.summaryIds.push(summaryId);
        const sync = await this.options.summarySync.syncPendingSummary(summaryId);
        sync.status === "synced" ? result.compressed++ : result.skipped++;
      } catch { result.skipped++; }
    }
    return result;
  }
  private async persistPending(proposal: CompressionProposal): Promise<string> {
    const now = (this.options.now ?? (() => new Date()))().toISOString();
    const idFactory = this.options.idFactory ?? randomUUID;
    const summaryId = idFactory(); const evidenceId = idFactory();
    await this.options.store.update((draft) => {
      const sources = proposal.sourceMemoryIds.map((id) => draft.l2.find((memory) => memory.id === id));
      if (sources.some((source) => !source || (source.status !== "active" && source.status !== "aging"))) throw new Error("SUMMARY_SOURCE_STALE");
      const snapshots = sources.map((source) => ({ memoryId: source!.id, updatedAt: source!.updatedAt }));
      if (proposal.sourceSnapshots?.some((snapshot) => snapshots.find(({ memoryId }) => memoryId === snapshot.memoryId)?.updatedAt !== snapshot.updatedAt)) throw new Error("SUMMARY_SOURCE_STALE");
      draft.evidence.push({ id: evidenceId, memoryId: summaryId, quote: "", capturedAt: now, source: "reflection", sourceMemoryIds: [...proposal.sourceMemoryIds] });
      draft.l2.push({ id: summaryId, content: proposal.summary, confidence: proposal.confidence, importance: proposal.importance, evidenceIds: [evidenceId], createdAt: now, updatedAt: now, lastAccessedAt: now, accessCount: 0, weight: initialMemoryWeight(proposal.importance, proposal.confidence, true), isPinned: false, isEnabled: false, status: "active", syncStatus: "pending_sync", isSummary: true, sourceMemoryIds: [...proposal.sourceMemoryIds], sourceSnapshots: snapshots, conflictWith: [] });
    });
    return summaryId;
  }
}
