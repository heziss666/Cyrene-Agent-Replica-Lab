import { describe, expect, it } from "vitest";
import {
  priorityForMemoryConflictScore,
  scoreMemoryConflict,
} from "../../src/main/memory/memory-conflict-score.js";

describe("priorityForMemoryConflictScore", () => {
  it.each([
    [34, undefined],
    [35, "idle"],
    [54, "idle"],
    [55, "normal"],
    [74, "normal"],
    [75, "high"],
  ] as const)("maps score %i to %s priority", (score, priority) => {
    expect(priorityForMemoryConflictScore(score)).toBe(priority);
  });
});

describe("scoreMemoryConflict", () => {
  it("penalizes pairs without evidence", () => {
    const withEvidence = scoreMemoryConflict({
      semanticSimilarity: 0.8,
      correctionIntent: true,
      localContradiction: true,
      evidence: "both",
    });
    const withoutEvidence = scoreMemoryConflict({
      semanticSimilarity: 0.8,
      correctionIntent: true,
      localContradiction: true,
      evidence: "none",
    });

    expect(withoutEvidence.score).toBe(withEvidence.score - 35);
    expect(withoutEvidence.priority).toBe("idle");
    expect(withoutEvidence.missingEvidence).toBe(true);
  });

  it("penalizes vague token-only overlap", () => {
    const concrete = scoreMemoryConflict({
      semanticSimilarity: 0.8,
      correctionIntent: true,
      localContradiction: true,
      evidence: "both",
    });
    const vague = scoreMemoryConflict({
      semanticSimilarity: 0.8,
      correctionIntent: true,
      localContradiction: true,
      evidence: "both",
      vagueTokenOnlyOverlap: true,
    });

    expect(vague.score).toBe(concrete.score - 20);
    expect(vague.vagueTokenOnlyOverlap).toBe(true);
  });

  it("records pin protection without making an otherwise unrelated pair a conflict", () => {
    const result = scoreMemoryConflict({
      semanticSimilarity: 0,
      evidence: "both",
      pinnedTarget: true,
    });

    expect(result).toMatchObject({
      score: 15,
      priority: undefined,
      pinnedTarget: true,
    });
  });
});
