import { MemoryCompressionService } from "./memory-compression-service.js";
import { validateEntityExtraction } from "./entity-graph-extractor.js";
import type { EntityGraphService } from "./entity-graph.js";
import type { ReflectionProposal, ReflectionVerification, ReflectionVerificationInput } from "./memory-reflection-types.js";
import type { MemoryProfilePromoter } from "./memory-profile-promoter.js";
import type { MemoryStore } from "./memory-store.js";
import type { EntityExtraction } from "./entity-graph-types.js";
import { normalizeMemoryContent } from "./memory-content-policy.js";

export class MemoryIntelligenceService {
  private proposal?: ReflectionProposal;
  constructor(private readonly options: {
    store: MemoryStore;
    reflection: { reflect(input: { l0: Awaited<ReturnType<MemoryStore["load"]>>["l0"]; l1: Awaited<ReturnType<MemoryStore["load"]>>["l1"]; sources: Array<{ id: string; content: string; updatedAt: string }>; evidence: Array<{ id: string; memoryId: string; quote: string; capturedAt: string }> }): Promise<ReflectionProposal> };
    verifier: { verify(input: ReflectionVerificationInput, threshold: number): Promise<ReflectionVerification> };
    promoter: Pick<MemoryProfilePromoter, "applyProfileUpdates">;
    compression: Pick<MemoryCompressionService, "compressEligibleMemories">;
    entityGraph: Pick<EntityGraphService, "rebuild">;
  }) {}

  async reflectAndPromote() {
    const file = await this.options.store.load();
    const sources = file.l2.filter((memory) => memory.isEnabled && (memory.status === "active" || memory.status === "aging")).map(({ id, content, updatedAt }) => ({ id, content, updatedAt }));
    const evidence = file.evidence.filter(({ memoryId }) => sources.some(({ id }) => id === memoryId)).map(({ id, memoryId, quote, capturedAt }) => ({ id, memoryId, quote, capturedAt }));
    this.proposal = await this.options.reflection.reflect({ l0: file.l0, l1: file.l1, sources, evidence });
    const verifications: ReflectionVerification[] = [];
    for (const proposal of this.proposal.profileUpdates) {
      try { verifications.push(await this.options.verifier.verify({ proposal, sources, evidence }, proposal.layer === "L0" ? 0.9 : 0.85)); }
      catch { verifications.push({ supported: false, confidence: 0, claims: [], reason: "verification_failed" }); }
    }
    const promoted = await this.options.promoter.applyProfileUpdates(this.proposal.profileUpdates, verifications);
    return { proposedCount: this.proposal.profileUpdates.length, acceptedCount: promoted.acceptedCount, skippedCount: promoted.skippedCount };
  }

  compress() { return this.options.compression.compressEligibleMemories(); }

  async rebuildEntityGraph() {
    const file = await this.options.store.load();
    const extraction = validateEntityExtraction(remapExtraction(this.proposal, file), file);
    const graph = await this.options.entityGraph.rebuild(file, extraction);
    return { nodeCount: graph.nodes.length, relationCount: graph.relations.length };
  }
}

function remapExtraction(proposal: ReflectionProposal | undefined, file: Awaited<ReturnType<MemoryStore["load"]>>): EntityExtraction {
  if (!proposal) return { entities: [], relations: [] };
  const remap = (id: string, requiredText?: string): string | undefined => {
    const memory = file.l2.find((item) => item.id === id);
    if (!memory) return undefined;
    if (memory.isEnabled && (memory.status === "active" || memory.status === "aging")) return memory.id;
    if (memory.status !== "merged" || !memory.mergedInto) return undefined;
    const summary = file.l2.find((item) => item.id === memory.mergedInto && item.isEnabled && item.syncStatus === "synced");
    if (!summary || requiredText && !normalizeMemoryContent(summary.content).includes(normalizeMemoryContent(requiredText))) return undefined;
    return summary.id;
  };
  const entities = proposal.entities.map((entity) => ({ ...entity, sourceMemoryIds: [...new Set(entity.sourceMemoryIds.map((id) => remap(id, entity.name)).filter((id): id is string => Boolean(id)))] })).filter(({ sourceMemoryIds }) => sourceMemoryIds.length > 0);
  const byName = new Map(entities.map((entity) => [normalizeMemoryContent(entity.name).toLocaleLowerCase(), entity]));
  const relations = proposal.relations.map((relation) => {
    const from = byName.get(normalizeMemoryContent(relation.fromName).toLocaleLowerCase());
    const to = byName.get(normalizeMemoryContent(relation.toName).toLocaleLowerCase());
    const sourceMemoryIds = [...new Set(relation.sourceMemoryIds.map((id) => remap(id)).filter((id): id is string => Boolean(id)).filter((id) => from?.sourceMemoryIds.includes(id) && to?.sourceMemoryIds.includes(id)))];
    return { ...relation, sourceMemoryIds };
  }).filter(({ sourceMemoryIds }) => sourceMemoryIds.length > 0);
  return { entities, relations };
}
