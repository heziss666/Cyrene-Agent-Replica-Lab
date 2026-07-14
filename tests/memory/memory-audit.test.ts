import { describe, expect, it } from "vitest";
import { auditMemoryFile } from "../../src/main/memory/memory-audit.js";
import {
  createEmptyMemoryFileV2,
  type L2MemoryV2,
  type MemoryFile,
} from "../../src/main/memory/memory-types.js";

const TIME = "2026-07-14T00:00:00.000Z";

function createMemory(
  id: string,
  overrides: Partial<L2MemoryV2> = {},
): L2MemoryV2 {
  return {
    id,
    content: `Content for ${id}`,
    confidence: 0.9,
    importance: "high",
    evidenceIds: [`evidence-${id}`],
    createdAt: TIME,
    updatedAt: TIME,
    lastAccessedAt: TIME,
    accessCount: 0,
    weight: 0.765,
    isPinned: false,
    isEnabled: true,
    status: "active",
    syncStatus: "synced",
    isSummary: false,
    sourceMemoryIds: [],
    sourceSnapshots: [],
    conflictWith: [],
    ...overrides,
  };
}

function createFile(memories: L2MemoryV2[]): MemoryFile {
  return {
    ...createEmptyMemoryFileV2(),
    l2: memories,
    evidence: memories.flatMap((memory) => memory.evidenceIds.map((id) => ({
      id,
      memoryId: memory.id,
      quote: memory.content,
      capturedAt: TIME,
      source: "conversation" as const,
      sourceMemoryIds: [],
    }))),
  };
}

describe("auditMemoryFile", () => {
  it("returns no findings for a structurally consistent file", () => {
    const first = createMemory("first", { conflictWith: ["second"] });
    const second = createMemory("second", { conflictWith: ["first"] });
    const file = createFile([first, second]);
    file.conflictLogs = [{
      id: "conflict-1",
      sourceMemoryId: "first",
      targetMemoryId: "second",
      createdAt: TIME,
      status: "uncertain",
      score: 70,
      priority: "normal",
      signals: {},
      attempts: 1,
    }];

    expect(auditMemoryFile(file)).toEqual({ ok: true, findings: [] });
  });

  it("flags missing or mismatched evidence without exposing quotes", () => {
    const memory = createMemory("memory-1", {
      evidenceIds: ["missing-evidence", "wrong-owner-evidence"],
      content: "private memory content",
    });
    const file = createFile([memory]);
    file.evidence = [{
      id: "wrong-owner-evidence",
      memoryId: "someone-else",
      quote: "private evidence quote",
      capturedAt: TIME,
      source: "conversation",
      sourceMemoryIds: [],
    }];

    const report = auditMemoryFile(file);

    expect(report).toEqual({
      ok: false,
      findings: [
        {
          code: "missing_evidence",
          severity: "error",
          targetId: "memory-1",
          relatedId: "missing-evidence",
        },
        {
          code: "missing_evidence",
          severity: "error",
          targetId: "memory-1",
          relatedId: "wrong-owner-evidence",
        },
      ],
    });
    expect(JSON.stringify(report)).not.toContain("private memory content");
    expect(JSON.stringify(report)).not.toContain("private evidence quote");
  });

  it("flags a memory that has no evidence IDs", () => {
    const memory = createMemory("memory-without-evidence", { evidenceIds: [] });

    expect(auditMemoryFile(createFile([memory]))).toEqual({
      ok: false,
      findings: [{
        code: "missing_evidence",
        severity: "error",
        targetId: "memory-without-evidence",
      }],
    });
  });

  it("flags broken resolution links and summaries with missing sources", () => {
    const superseded = createMemory("superseded", {
      status: "superseded",
      supersededBy: "missing-winner",
    });
    const merged = createMemory("merged", {
      status: "merged",
      mergedInto: "missing-merge-target",
    });
    const summary = createMemory("summary", {
      isSummary: true,
      sourceMemoryIds: ["missing-source"],
    });
    const report = auditMemoryFile(createFile([superseded, merged, summary]));

    expect(report.findings).toEqual([
      {
        code: "broken_superseded_by",
        severity: "error",
        targetId: "superseded",
        relatedId: "missing-winner",
      },
      {
        code: "broken_merged_into",
        severity: "error",
        targetId: "merged",
        relatedId: "missing-merge-target",
      },
      {
        code: "summary_source_missing",
        severity: "error",
        targetId: "summary",
        relatedId: "missing-source",
      },
    ]);
  });

  it("flags active conflict markers that have no live conflict log", () => {
    const first = createMemory("first", { conflictWith: ["second", "third"] });
    const second = createMemory("second", { conflictWith: ["first"] });
    const third = createMemory("third");
    const file = createFile([first, second, third]);
    file.conflictLogs = [{
      id: "resolved-history",
      sourceMemoryId: "first",
      targetMemoryId: "second",
      createdAt: TIME,
      status: "resolved",
      score: 80,
      priority: "high",
      signals: {},
      attempts: 1,
    }];

    expect(auditMemoryFile(file).findings).toEqual([
      {
        code: "active_conflict_without_live_log",
        severity: "warning",
        targetId: "first",
        relatedId: "second",
      },
      {
        code: "active_conflict_without_live_log",
        severity: "warning",
        targetId: "first",
        relatedId: "third",
      },
      {
        code: "active_conflict_without_live_log",
        severity: "warning",
        targetId: "second",
        relatedId: "first",
      },
    ]);
  });
});
