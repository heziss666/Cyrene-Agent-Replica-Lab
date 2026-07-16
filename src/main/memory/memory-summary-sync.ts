import type { EmbeddingProvider } from "../rag/embedding-provider.js";
import { hashText } from "../rag/text-hash.js";
import type { VectorIndex } from "../rag/vector-index-types.js";
import type { MemoryStore } from "./memory-store.js";

export interface SummarySyncResult { summaryId: string; status: "synced" | "failed" | "stale" }

export class MemorySummarySync {
  constructor(private readonly options: { store: MemoryStore; embeddingProvider: EmbeddingProvider; vectorIndex: VectorIndex; now?: () => Date; idFactory?: () => string }) {}

  async syncPendingSummary(summaryId: string): Promise<SummarySyncResult> {
    const snapshot = await this.options.store.load();
    const summary = snapshot.l2.find((memory) => memory.id === summaryId && memory.isSummary);
    if (!summary || summary.isEnabled || (summary.syncStatus !== "pending_sync" && summary.syncStatus !== "sync_failed")) return { summaryId, status: "stale" };
    if (!sourcesUnchanged(snapshot.l2, summary.sourceSnapshots)) {
      await this.markFailed(summaryId);
      return { summaryId, status: "stale" };
    }
    try {
      const [vector] = await this.options.embeddingProvider.embedDocuments([summary.content]);
      if (!vector) throw new Error("Missing summary embedding");
      await this.options.vectorIndex.initialize();
      await this.options.vectorIndex.addMany([{ chunkId: summary.id, textHash: hashText(summary.content), vector }]);
    } catch {
      await this.markFailed(summaryId);
      return { summaryId, status: "failed" };
    }
    const timestamp = (this.options.now ?? (() => new Date()))().toISOString();
    await this.options.store.update((draft) => {
      const current = draft.l2.find((memory) => memory.id === summaryId && memory.isSummary);
      if (!current || !sourcesUnchanged(draft.l2, current.sourceSnapshots)) throw new Error("SUMMARY_SOURCES_STALE");
      current.isEnabled = true;
      current.syncStatus = "synced";
      current.updatedAt = timestamp;
      for (const sourceId of current.sourceMemoryIds) {
        const source = draft.l2.find((memory) => memory.id === sourceId);
        if (!source) throw new Error("SUMMARY_SOURCE_MISSING");
        source.status = "merged"; source.mergedInto = current.id; source.updatedAt = timestamp;
      }
      draft.reflectionLogs.push({ id: (this.options.idFactory ?? (() => `compression-${summaryId}`))(), createdAt: timestamp, type: "compression", sourceMemoryIds: [...current.sourceMemoryIds], acceptedCount: 1, skippedCount: 0 });
    });
    return { summaryId, status: "synced" };
  }

  async retryPendingSummarySync(): Promise<SummarySyncResult[]> {
    const file = await this.options.store.load();
    const pending = file.l2.filter((memory) => memory.isSummary && !memory.isEnabled && (memory.syncStatus === "pending_sync" || memory.syncStatus === "sync_failed"));
    const results: SummarySyncResult[] = [];
    for (const memory of pending) results.push(await this.syncPendingSummary(memory.id));
    return results;
  }

  private async markFailed(summaryId: string): Promise<void> {
    await this.options.store.update((draft) => {
      const current = draft.l2.find((memory) => memory.id === summaryId);
      if (current) { current.isEnabled = false; current.syncStatus = "sync_failed"; }
    });
  }
}

function sourcesUnchanged(memories: Array<{ id: string; updatedAt: string; status: string }>, snapshots: Array<{ memoryId: string; updatedAt: string }>): boolean {
  return snapshots.length >= 3 && snapshots.every((snapshot) => {
    const source = memories.find(({ id }) => id === snapshot.memoryId);
    return source !== undefined && (source.status === "active" || source.status === "aging") && source.updatedAt === snapshot.updatedAt;
  });
}
