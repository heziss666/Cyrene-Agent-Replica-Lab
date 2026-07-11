import { describe, expect, it } from "vitest";
import {
  extractSearchTerms,
  searchChunksByKeyword,
} from "../../src/main/rag/keyword-retriever.js";
import type { KnowledgeChunk } from "../../src/main/rag/rag-types.js";

function chunk(id: string, title: string, text: string): KnowledgeChunk {
  return {
    id,
    documentId: "doc",
    title,
    text,
    source: "test",
    index: 0,
  };
}

describe("extractSearchTerms", () => {
  it("extracts lowercase English terms, numbers, and Chinese terms", () => {
    expect(extractSearchTerms("RAG Phase 6A 知识库 检索")).toEqual([
      "rag",
      "phase",
      "6a",
      "知识库",
      "检索",
    ]);
  });

  it("returns an empty array for blank query", () => {
    expect(extractSearchTerms("   ")).toEqual([]);
  });
});

describe("searchChunksByKeyword", () => {
  it("ranks chunks with more matches first", () => {
    const results = searchChunksByKeyword("agent 工具", [
      chunk("a", "Agent Tools", "Agent can call tools. Tools return observations."),
      chunk("b", "Session", "Session stores chat messages."),
      chunk("c", "工具系统", "工具 schema 会发送给模型。"),
    ]);

    expect(results.map((result) => result.chunk.id)).toEqual(["a", "c"]);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("adds score when the title matches", () => {
    const results = searchChunksByKeyword("rag", [
      chunk("a", "RAG", "unrelated body"),
      chunk("b", "Other", "rag appears in body"),
    ]);

    expect(results[0].chunk.id).toBe("a");
  });

  it("respects topK", () => {
    const results = searchChunksByKeyword(
      "agent",
      [
        chunk("a", "A", "agent"),
        chunk("b", "B", "agent"),
        chunk("c", "C", "agent"),
      ],
      { topK: 2 },
    );

    expect(results).toHaveLength(2);
  });

  it("returns no results for empty query", () => {
    const results = searchChunksByKeyword(" ", [chunk("a", "A", "agent")]);
    expect(results).toEqual([]);
  });
});
