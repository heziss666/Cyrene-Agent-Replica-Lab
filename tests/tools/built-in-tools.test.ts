import { describe, expect, it } from "vitest";
import type { EmbeddingProvider } from "../../src/main/rag/embedding-provider.js";
import { createDefaultToolRegistry } from "../../src/main/tools/built-in-tools.js";

const fakeEmbeddingProvider: EmbeddingProvider = {
  id: "fake",
  model: "fake-model",
  embedDocuments: async (texts) => texts.map((_, index) => [index + 1, 1]),
  embedQuery: async () => [1, 1],
};

describe("createDefaultToolRegistry", () => {
  it("registers the default safe tools", () => {
    const registry = createDefaultToolRegistry();

    expect(registry.getEnabledTools().map((tool) => tool.id)).toEqual([
      "get_current_time",
      "calculator",
      "echo",
      "search_knowledge",
    ]);
  });

  it("exposes the search_knowledge schema to the model", () => {
    const registry = createDefaultToolRegistry();

    const specs = registry.getEnabledToolSpecs();

    expect(specs.some((spec) => spec.name === "search_knowledge")).toBe(true);
  });

  it("echoes text", async () => {
    const tool = createDefaultToolRegistry().getById("echo");

    await expect(tool?.execute({ text: "hello tools" })).resolves.toBe("hello tools");
  });

  it("calculates a simple arithmetic expression", async () => {
    const tool = createDefaultToolRegistry().getById("calculator");

    await expect(tool?.execute({ expression: "2 + 3 * (4 - 1)" })).resolves.toBe("11");
  });

  it("rejects unsafe calculator expressions", async () => {
    const tool = createDefaultToolRegistry().getById("calculator");

    await expect(tool?.execute({ expression: "process.exit()" })).resolves.toContain(
      "[error]",
    );
  });

  it("returns the current time as an ISO string", async () => {
    const tool = createDefaultToolRegistry().getById("get_current_time");
    const output = await tool?.execute({});

    expect(output).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(Number.isNaN(Date.parse(output ?? ""))).toBe(false);
  });

  it("search_knowledge returns vector snippets and diagnostics", async () => {
    const tool = createDefaultToolRegistry({
      embeddingProvider: fakeEmbeddingProvider,
    }).getById("search_knowledge");

    const output = await tool?.execute({
      query: "ToolRegistry",
      topK: 2,
    });

    expect(output).toContain("retrieval_mode: vector");
    expect(output).toContain("embedding_model: fake-model");
    expect(output).toContain("content:");
  });
});
