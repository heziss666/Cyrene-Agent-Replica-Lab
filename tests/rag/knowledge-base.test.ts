import { describe, expect, it } from "vitest";
import { createKnowledgeBase } from "../../src/main/rag/knowledge-base.js";

describe("createKnowledgeBase", () => {
  it("adds documents and searches their chunks", () => {
    const knowledgeBase = createKnowledgeBase();

    const chunks = knowledgeBase.addDocument({
      title: "Agent Tools",
      text: "The agent can call tools through the ToolRegistry.",
      source: "test",
    });

    expect(chunks).toHaveLength(1);

    const results = knowledgeBase.search("ToolRegistry", 3);

    expect(results).toHaveLength(1);
    expect(results[0].chunk.title).toBe("Agent Tools");
  });

  it("loads initial documents", () => {
    const knowledgeBase = createKnowledgeBase([
      {
        id: "initial_doc",
        title: "Initial Knowledge",
        text: "RAG means retrieval augmented generation.",
        source: "seed",
      },
    ]);

    expect(knowledgeBase.search("retrieval")).toHaveLength(1);
  });

  it("clears all documents and chunks", () => {
    const knowledgeBase = createKnowledgeBase();

    knowledgeBase.addDocument({
      title: "Temporary",
      text: "This should disappear.",
      source: "test",
    });

    knowledgeBase.clear();

    expect(knowledgeBase.search("disappear")).toEqual([]);
  });

  it("creates stable generated document ids", () => {
    const knowledgeBase = createKnowledgeBase();

    const first = knowledgeBase.addDocument({
      title: "First",
      text: "alpha",
      source: "test",
    });
    const second = knowledgeBase.addDocument({
      title: "Second",
      text: "beta",
      source: "test",
    });

    expect(first[0].documentId).toBe("doc_1");
    expect(second[0].documentId).toBe("doc_2");
  });
});
