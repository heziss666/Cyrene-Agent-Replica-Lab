import type { ConflictPriority, ConflictSignals } from "./memory-types.js";

export type ConflictEvidenceLevel = "none" | "one_side" | "both";

export interface MemoryConflictScoreInput {
  semanticSimilarity?: number;
  sharedTopic?: boolean;
  correctionIntent?: boolean;
  preferenceEvolution?: boolean;
  recentInjection?: boolean;
  localContradiction?: boolean;
  evidence: ConflictEvidenceLevel;
  coreProfileImpact?: "low" | "medium" | "high";
  vagueTokenOnlyOverlap?: boolean;
  pinnedTarget?: boolean;
}

export interface MemoryConflictScore {
  score: number;
  priority: ConflictPriority | undefined;
  signals: ConflictSignals;
  missingEvidence: boolean;
  vagueTokenOnlyOverlap: boolean;
  pinnedTarget: boolean;
}

export function priorityForMemoryConflictScore(score: number): ConflictPriority | undefined {
  if (score >= 75) return "high";
  if (score >= 55) return "normal";
  if (score >= 35) return "idle";
  return undefined;
}

function semanticPoints(similarity: number | undefined): number {
  if (similarity === undefined || !Number.isFinite(similarity) || similarity <= 0) return 0;
  if (similarity >= 0.75) return 25;
  if (similarity >= 0.45) return 18;
  return 10;
}

function evidencePoints(evidence: ConflictEvidenceLevel): number {
  if (evidence === "both") return 15;
  if (evidence === "one_side") return 8;
  return 0;
}

function impactPoints(impact: MemoryConflictScoreInput["coreProfileImpact"]): number {
  if (impact === "high") return 10;
  if (impact === "medium") return 6;
  if (impact === "low") return 3;
  return 0;
}

export function scoreMemoryConflict(input: MemoryConflictScoreInput): MemoryConflictScore {
  const similarity = input.semanticSimilarity;
  const missingEvidence = input.evidence === "none";
  const vagueTokenOnlyOverlap = input.vagueTokenOnlyOverlap === true;
  const pinnedTarget = input.pinnedTarget === true;
  const contradictionPoints = input.localContradiction ? 10 : 0;
  let score = semanticPoints(similarity)
    + (input.correctionIntent ? 20 : 0)
    + (input.preferenceEvolution ? 15 : 0)
    + (input.recentInjection ? 20 : 0)
    + evidencePoints(input.evidence)
    + contradictionPoints
    + impactPoints(input.coreProfileImpact);

  if (missingEvidence) score -= 20;
  if (vagueTokenOnlyOverlap) score -= 20;
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    priority: priorityForMemoryConflictScore(score),
    signals: {
      score,
      ...(similarity === undefined ? {} : { semanticSimilarity: similarity }),
      contradictionScore: contradictionPoints,
      entityOverlap: input.sharedTopic ? 1 : 0,
      temporalOverlap: input.preferenceEvolution ? 1 : 0,
    },
    missingEvidence,
    vagueTokenOnlyOverlap,
    pinnedTarget,
  };
}
