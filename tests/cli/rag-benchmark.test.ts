import { describe, expect, it, vi } from "vitest";
import type { KnowledgeBase } from "../../src/main/rag/knowledge-base.js";
import type { KnowledgeSearchResponse } from "../../src/main/rag/rag-types.js";
import {
  calculateRecallAtK,
  formatRagBenchmarkReport,
  runRagBenchmark,
  type RagBenchmarkDependencies,
  type RagEvaluationCase,
} from "../../src/cli/rag-benchmark.js";

const evaluationCases: RagEvaluationCase[] = [
  { question: "question a", expectedDocumentIds: ["a"] },
  { question: "question x", expectedDocumentIds: ["x", "x-alternative"] },
];

function response(documentIds: string[]): KnowledgeSearchResponse {
  return {
    mode: "vector",
    model: "fake-model",
    results: documentIds.map((documentId, index) => ({
      score: 1 - index / 10,
      chunk: {
        id: `${documentId}_chunk_0`,
        documentId,
        title: documentId,
        source: "fixture",
        text: documentId,
        index: 0,
      },
    })),
  };
}

describe("calculateRecallAtK", () => {
  it("counts a case when any accepted document is retrieved within k", () => {
    const results = [
      { expectedDocumentIds: ["a"], returnedDocumentIds: ["b", "a", "c"] },
      { expectedDocumentIds: ["x", "x-alt"], returnedDocumentIds: ["x", "y"] },
    ];

    expect(calculateRecallAtK(results, 1)).toBe(0.5);
    expect(calculateRecallAtK(results, 3)).toBe(1);
  });

  it("returns zero for an empty evaluation set", () => {
    expect(calculateRecallAtK([], 5)).toBe(0);
  });
});

describe("runRagBenchmark", () => {
  it("measures cold, warm, query, index, and recall metrics with injected services", async () => {
    let warmSearchCount = 0;
    const cold: Pick<KnowledgeBase, "search"> = {
      search: vi.fn(async () => response([])),
    };
    const warm: Pick<KnowledgeBase, "search"> = {
      search: vi.fn(async () => {
        warmSearchCount += 1;
        if (warmSearchCount === 1) return response([]);
        if (warmSearchCount === 2) return response(["b", "a"]);
        return response(["x"]);
      }),
    };
    const createKnowledgeBase = vi.fn()
      .mockReturnValueOnce(cold)
      .mockReturnValueOnce(warm);
    const removeTemporaryDirectory = vi.fn(async () => undefined);
    const times = [0, 10, 20, 25, 30, 32, 40, 45];
    const dependencies: RagBenchmarkDependencies = {
      createTemporaryDirectory: async () => "C:/temp/rag-benchmark",
      removeTemporaryDirectory,
      createKnowledgeBase,
      loadDocuments: () => [
        { id: "a", title: "A", source: "fixture", text: "alpha" },
        { id: "x", title: "X", source: "fixture", text: "x-ray" },
      ],
      countMarkdownFiles: () => 2,
      readIndexStats: async () => ({ vectorDimensions: 3, indexBytes: 512 }),
      now: () => times.shift()!,
    };

    await expect(runRagBenchmark({ evaluationCases, dependencies })).resolves.toEqual({
      markdownFileCount: 2,
      documentCount: 2,
      chunkCount: 2,
      vectorDimensions: 3,
      indexBytes: 512,
      coldBuildMs: 10,
      warmLoadMs: 5,
      averageQueryMs: 3.5,
      recallAt1: 0.5,
      recallAt3: 1,
      recallAt5: 1,
    });
    expect(createKnowledgeBase).toHaveBeenCalledTimes(2);
    expect(removeTemporaryDirectory).toHaveBeenCalledWith("C:/temp/rag-benchmark");
  });

  it("rejects keyword fallback instead of reporting it as vector performance", async () => {
    const vectorSession: Pick<KnowledgeBase, "search"> = {
      search: vi.fn(async () => response([])),
    };
    const fallbackSession: Pick<KnowledgeBase, "search"> = {
      search: vi.fn(async () => ({
        ...response([]),
        mode: "keyword-fallback" as const,
        model: undefined,
      })),
    };
    const removeTemporaryDirectory = vi.fn(async () => undefined);
    const dependencies: RagBenchmarkDependencies = {
      createTemporaryDirectory: async () => "C:/temp/rag-benchmark",
      removeTemporaryDirectory,
      createKnowledgeBase: vi.fn()
        .mockReturnValueOnce(vectorSession)
        .mockReturnValueOnce(fallbackSession),
      loadDocuments: () => [],
      countMarkdownFiles: () => 0,
      readIndexStats: async () => ({ vectorDimensions: 3, indexBytes: 512 }),
      now: () => 0,
    };

    await expect(runRagBenchmark({ evaluationCases, dependencies })).rejects.toThrow(
      "requires vector retrieval",
    );
    expect(removeTemporaryDirectory).toHaveBeenCalledWith("C:/temp/rag-benchmark");
  });
});

describe("formatRagBenchmarkReport", () => {
  it("prints all acceptance metrics", () => {
    const output = formatRagBenchmarkReport({
      markdownFileCount: 6,
      documentCount: 71,
      chunkCount: 100,
      vectorDimensions: 2560,
      indexBytes: 1024,
      coldBuildMs: 1200,
      warmLoadMs: 80,
      averageQueryMs: 25.5,
      recallAt1: 0.5,
      recallAt3: 0.75,
      recallAt5: 1,
    });

    expect(output).toContain("Markdown files: 6");
    expect(output).toContain("Vector dimensions: 2560");
    expect(output).toContain("Recall@1: 0.500");
    expect(output).toContain("Recall@5: 1.000");
  });
});
