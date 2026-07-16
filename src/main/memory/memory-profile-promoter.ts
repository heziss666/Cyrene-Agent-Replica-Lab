import { randomUUID } from "node:crypto";
import { normalizeMemoryContent, validateUserEditedMemoryContent } from "./memory-content-policy.js";
import type { ReflectionProfileUpdate, ReflectionVerification } from "./memory-reflection-types.js";
import type { MemoryStore } from "./memory-store.js";
import type { L0Field, L1Field, MemoryFile, ProfileFieldMetadata } from "./memory-types.js";

export interface PromotionSummary { acceptedCount: number; skippedCount: number; acceptedFields: string[] }

export class MemoryProfilePromoter {
  constructor(private readonly options: { store: MemoryStore; now?: () => Date; idFactory?: () => string }) {}

  async applyProfileUpdates(proposals: readonly ReflectionProfileUpdate[], verifications: readonly ReflectionVerification[]): Promise<PromotionSummary> {
    const now = (this.options.now ?? (() => new Date()))().toISOString();
    const summary: PromotionSummary = { acceptedCount: 0, skippedCount: 0, acceptedFields: [] };
    await this.options.store.update((draft) => {
      proposals.forEach((proposal, index) => {
        const verification = verifications[index];
        if (!verification || !canApply(draft, proposal, verification)) { summary.skippedCount++; return; }
        applyUpdate(draft, proposal, verification.confidence, now);
        summary.acceptedCount++;
        summary.acceptedFields.push(`${proposal.layer}.${proposal.field}`);
      });
      draft.reflectionLogs.push({ id: (this.options.idFactory ?? randomUUID)(), createdAt: now, type: summary.acceptedFields.some((field) => field.startsWith("L0.")) ? "l0_update" : "l1_update", sourceMemoryIds: [...new Set(proposals.flatMap(({ sourceMemoryIds }) => sourceMemoryIds))], acceptedCount: summary.acceptedCount, skippedCount: summary.skippedCount });
    });
    return summary;
  }
}

function canApply(file: MemoryFile, proposal: ReflectionProfileUpdate, verification: ReflectionVerification): boolean {
  const required = proposal.layer === "L0" ? 3 : 2;
  const threshold = proposal.layer === "L0" ? 0.9 : 0.85;
  if (new Set(proposal.sourceMemoryIds).size < required || !verification.supported
    || verification.confidence < threshold || proposal.confidence < threshold
    || validateUserEditedMemoryContent(proposal.content).ok === false) return false;
  const metadata = proposal.layer === "L0" ? file.l0.fieldMetadata?.[proposal.field as L0Field] : file.l1.fieldMetadata?.[proposal.field as L1Field];
  if (metadata?.source === "user_edit" || !proposal.sourceSnapshots) return false;
  const sources = proposal.sourceMemoryIds.map((id) => file.l2.find((memory) => memory.id === id));
  if (sources.some((memory) => !memory || !["active", "aging"].includes(memory.status)
    || proposal.sourceSnapshots!.find(({ memoryId }) => memoryId === memory.id)?.updatedAt !== memory.updatedAt
    || memory.evidenceIds.some((id) => !file.evidence.some((evidence) => evidence.id === id))
    || (memory.isSummary && memory.sourceMemoryIds.some((id) => !file.l2.some((source) => source.id === id))))) return false;
  if (proposal.claims.some((claim) => claim.evidenceIds.some((id) => !file.evidence.some((evidence) => evidence.id === id)))) return false;
  if (proposal.layer === "L0") {
    const captures = proposal.sourceMemoryIds.flatMap((id) => file.evidence.filter(({ memoryId }) => memoryId === id).map(({ capturedAt }) => Date.parse(capturedAt))).filter(Number.isFinite);
    const distinct = new Set(captures).size;
    const span = captures.length ? Math.max(...captures) - Math.min(...captures) : 0;
    if (distinct < 3 && span < 7 * 86_400_000) return false;
  }
  return true;
}

function applyUpdate(file: MemoryFile, proposal: ReflectionProfileUpdate, confidence: number, now: string): void {
  const content = normalizeMemoryContent(proposal.content);
  const metadata: ProfileFieldMetadata = { updatedAt: now, source: "reflection", confidence };
  const target = proposal.layer === "L0" ? file.l0 : file.l1;
  const arrays = new Set(["longTermInterests", "permanentNotes", "recentGoals", "recentPreferences"]);
  if (arrays.has(proposal.field)) {
    const values = (target as unknown as Record<string, unknown>)[proposal.field] as string[];
    if (!values.some((value) => normalizeMemoryContent(value).toLocaleLowerCase() === content.toLocaleLowerCase())) values.push(content);
  } else {
    (target as unknown as Record<string, unknown>)[proposal.field] = content;
  }
  target.updatedAt = now;
  target.fieldMetadata ??= {};
  (target.fieldMetadata as Record<string, ProfileFieldMetadata>)[proposal.field] = metadata;
}
