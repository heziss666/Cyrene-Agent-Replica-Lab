import { randomUUID } from "node:crypto";
import { findPossibleConflictCandidate } from "./memory-conflict.js";
import { scoreMemoryConflict } from "./memory-conflict-score.js";
import type { MemoryStore } from "./memory-store.js";
import type { L2MemoryV2, MemoryEvidence } from "./memory-types.js";

const MAX_VECTOR_NEIGHBORS = 5;
const MAX_CONFLICT_LOGS = 200;

export interface ConflictVectorNeighbor {
  memoryId: string;
  similarity: number;
}

export interface MemoryConflictService {
  inspectNewMemory(id: string): Promise<void>;
}

export interface CreateMemoryConflictServiceOptions {
  store: MemoryStore;
  vectorNeighbors: (
    memory: L2MemoryV2,
    limit: number,
  ) => Promise<readonly ConflictVectorNeighbor[]>;
  recentInjectionIds: () => Promise<readonly string[]> | readonly string[];
  now?: () => Date;
  idFactory?: () => string;
}

interface CandidateSource {
  similarity?: number;
  recentInjection: boolean;
}

interface MemoryConflictSnapshot {
  content: string;
  updatedAt: string;
  evidenceFingerprint: string;
}

function hasEvidence(memory: L2MemoryV2, evidence: readonly MemoryEvidence[]): boolean {
  const evidenceIds = new Set(memory.evidenceIds);
  return evidence.some((item) => item.memoryId === memory.id && evidenceIds.has(item.id));
}

function evidenceFingerprint(memory: L2MemoryV2, evidence: readonly MemoryEvidence[]): string {
  const evidenceById = new Map(
    evidence
      .filter((item) => item.memoryId === memory.id)
      .map((item) => [item.id, item]),
  );
  return [...memory.evidenceIds]
    .sort()
    .map((id) => {
      const item = evidenceById.get(id);
      return JSON.stringify(item === undefined ? [id] : [
        item.id,
        item.memoryId,
        item.quote,
        item.capturedAt,
        item.source,
        [...item.sourceMemoryIds].sort(),
      ]);
    })
    .join("|");
}

function snapshot(memory: L2MemoryV2, evidence: readonly MemoryEvidence[]): MemoryConflictSnapshot {
  return {
    content: memory.content,
    updatedAt: memory.updatedAt,
    evidenceFingerprint: evidenceFingerprint(memory, evidence),
  };
}

function matchesSnapshot(
  memory: L2MemoryV2,
  evidence: readonly MemoryEvidence[],
  expected: MemoryConflictSnapshot,
): boolean {
  return memory.content === expected.content
    && memory.updatedAt === expected.updatedAt
    && evidenceFingerprint(memory, evidence) === expected.evidenceFingerprint;
}

function isInspectableTarget(memory: L2MemoryV2): boolean {
  return memory.isEnabled && (memory.status === "active" || memory.status === "aging");
}

function addConflictReference(memory: L2MemoryV2, relatedId: string): void {
  if (!memory.conflictWith.includes(relatedId)) memory.conflictWith.push(relatedId);
}

export function createMemoryConflictService(
  options: CreateMemoryConflictServiceOptions,
): MemoryConflictService {
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;

  async function inspectNewMemory(id: string, allowReinspection: boolean): Promise<void> {
      const file = await options.store.load();
      const source = file.l2.find((memory) => memory.id === id);
      if (!source || !isInspectableTarget(source)) return;

      const [vectorNeighbors, recentIds] = await Promise.all([
        options.vectorNeighbors(source, MAX_VECTOR_NEIGHBORS),
        options.recentInjectionIds(),
      ]);
      const candidates = new Map<string, CandidateSource>();
      for (const neighbor of vectorNeighbors.slice(0, MAX_VECTOR_NEIGHBORS)) {
        if (neighbor.memoryId === id || !Number.isFinite(neighbor.similarity)) continue;
        const current = candidates.get(neighbor.memoryId);
        candidates.set(neighbor.memoryId, {
          similarity: current?.similarity === undefined
            ? neighbor.similarity
            : Math.max(current.similarity, neighbor.similarity),
          recentInjection: current?.recentInjection ?? false,
        });
      }
      for (const recentId of recentIds) {
        if (recentId === id) continue;
        const current = candidates.get(recentId);
        candidates.set(recentId, {
          similarity: current?.similarity,
          recentInjection: true,
        });
      }

      const decisions = [...candidates.entries()].flatMap(([targetId, candidateSource]) => {
        const target = file.l2.find((memory) => memory.id === targetId);
        if (!target || !isInspectableTarget(target)) return [];
        const detected = findPossibleConflictCandidate(source.content, target.content);
        if (!detected.isCandidate) return [];
        const sourceHasEvidence = hasEvidence(source, file.evidence);
        const targetHasEvidence = hasEvidence(target, file.evidence);
        const evidence = sourceHasEvidence && targetHasEvidence
          ? "both"
          : sourceHasEvidence || targetHasEvidence
            ? "one_side"
            : "none";
        const score = scoreMemoryConflict({
          semanticSimilarity: candidateSource.similarity,
          sharedTopic: detected.sharedTopic,
          correctionIntent: detected.correctionIntent,
          preferenceEvolution: detected.preferenceEvolution,
          recentInjection: candidateSource.recentInjection,
          localContradiction: detected.correctionIntent || detected.preferenceEvolution,
          evidence,
          vagueTokenOnlyOverlap: detected.vagueTokenOnlyOverlap,
          pinnedTarget: target.isPinned,
        });
        const priority = score.priority;
        return score.score >= 35 && priority !== undefined
          ? [{
            targetId,
            score,
            priority,
            sourceSnapshot: snapshot(source, file.evidence),
            targetSnapshot: snapshot(target, file.evidence),
          }]
          : [];
      });
      if (decisions.length === 0) return;

      const createdAt = now().toISOString();
      let requiresReinspection = false;
      await options.store.update((draft) => {
        const currentSource = draft.l2.find((memory) => memory.id === id);
        if (!currentSource || !isInspectableTarget(currentSource)) {
          requiresReinspection = true;
          return;
        }

        for (const decision of decisions) {
          const target = draft.l2.find((memory) => memory.id === decision.targetId);
          if (!target || !isInspectableTarget(target)
            || !matchesSnapshot(currentSource, draft.evidence, decision.sourceSnapshot)
            || !matchesSnapshot(target, draft.evidence, decision.targetSnapshot)) {
            requiresReinspection = true;
            continue;
          }
          if (currentSource.conflictWith.includes(target.id)) {
            continue;
          }
          addConflictReference(currentSource, target.id);
          addConflictReference(target, currentSource.id);
          draft.conflictLogs.push({
            id: idFactory(),
            sourceMemoryId: currentSource.id,
            targetMemoryId: target.id,
            createdAt,
            status: "queued",
            score: decision.score.score,
            priority: decision.priority,
            attempts: 0,
            signals: decision.score.signals,
          });
        }
        if (draft.conflictLogs.length > MAX_CONFLICT_LOGS) {
          draft.conflictLogs = draft.conflictLogs.slice(-MAX_CONFLICT_LOGS);
        }
      });
      if (requiresReinspection && allowReinspection) {
        await inspectNewMemory(id, false);
      }
  }

  return {
    inspectNewMemory(id) {
      return inspectNewMemory(id, true);
    },
  };
}
