import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../../src/main/rag/embedding-provider.js";
import { createInMemoryVectorIndex } from "../../src/main/rag/in-memory-vector-index.js";
import { createDefaultToolRegistry } from "../../src/main/tools/built-in-tools.js";

const fakeEmbeddingProvider: EmbeddingProvider = {
  id: "fake",
  model: "fake-model",
  embedDocuments: async (texts) => texts.map((_, index) => [index + 1, 1]),
  embedQuery: async () => [1, 1],
};

function createTestToolRegistry() {
  return createDefaultToolRegistry({
    embeddingProvider: fakeEmbeddingProvider,
    vectorIndex: createInMemoryVectorIndex(),
  });
}

describe("createDefaultToolRegistry", () => {
  it("registers the default safe tools", () => {
    const registry = createTestToolRegistry();

    expect(registry.getEnabledTools().map((tool) => tool.id)).toEqual([
      "get_current_time",
      "calculator",
      "echo",
      "search_knowledge",
    ]);
  });

  it("exposes the search_knowledge schema to the model", () => {
    const registry = createTestToolRegistry();

    const specs = registry.getEnabledToolSpecs();

    expect(specs.some((spec) => spec.name === "search_knowledge")).toBe(true);
  });

  it("asks the model for a standalone semantic search question", () => {
    const registry = createTestToolRegistry();
    const searchSpec = registry
      .getEnabledToolSpecs()
      .find((spec) => spec.name === "search_knowledge");
    const queryDescription = searchSpec?.parameters.properties.query?.description;

    expect(searchSpec?.description).toContain("standalone natural-language question");
    expect(queryDescription).toContain("semantic vector search");
    expect(queryDescription).toContain("Do not output a disconnected keyword list");
  });

  it("echoes text", async () => {
    const tool = createTestToolRegistry().getById("echo");

    await expect(tool?.execute({ text: "hello tools" })).resolves.toBe("hello tools");
  });

  it("calculates a simple arithmetic expression", async () => {
    const tool = createTestToolRegistry().getById("calculator");

    await expect(tool?.execute({ expression: "2 + 3 * (4 - 1)" })).resolves.toBe("11");
  });

  it("rejects unsafe calculator expressions", async () => {
    const tool = createTestToolRegistry().getById("calculator");

    await expect(tool?.execute({ expression: "process.exit()" })).resolves.toContain(
      "[error]",
    );
  });

  it("returns the current time as an ISO string", async () => {
    const tool = createTestToolRegistry().getById("get_current_time");
    const output = await tool?.execute({});

    expect(output).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(Number.isNaN(Date.parse(output ?? ""))).toBe(false);
  });

  it("returns scheduled time in the task timezone", async () => {
    const tool = createTestToolRegistry().getById("get_current_time");
    const output = await tool?.execute({}, {
      runState: new Map(),
      emitEvent: () => undefined,
      executionMode: "scheduled",
      timezone: "Asia/Shanghai",
    });
    const parsed = JSON.parse(output ?? "{}");

    expect(parsed.timezone).toBe("Asia/Shanghai");
    expect(parsed.utc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.localTime).toContain("GMT+8");
  });

  it("search_knowledge returns vector snippets and diagnostics", async () => {
    const tool = createTestToolRegistry().getById("search_knowledge");

    const output = await tool?.execute({
      query: "昔涟最初是什么形态？",
      topK: 2,
    });

    expect(output).toContain("retrieval_mode: vector");
    expect(output).toContain("embedding_model: fake-model");
    expect(output).toContain("source: worldbook/");
    expect(output).toContain("content:");
  });

  it("persists vector search data at the configured JSON path", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "cyrene-rag-"));
    const vectorIndexPath = join(tempDir, "vector-index.json");
    const logger = vi.fn();

    try {
      const registry = createDefaultToolRegistry({
        embeddingProvider: fakeEmbeddingProvider,
        storageConfig: { dataDir: tempDir, vectorIndexPath },
        logger,
      });
      const output = await registry.getById("search_knowledge")?.execute({
        query: "昔涟和开拓者是什么关系？",
        topK: 2,
      });

      expect(await readFile(vectorIndexPath, "utf8")).toContain('"schemaVersion": 1');
      expect(output).toContain("retrieval_mode: vector");
      expect(output).toContain("embedding_model: fake-model");
      expect(logger).toHaveBeenCalledWith(
        expect.stringContaining("vector index missing"),
      );
      expect(logger).toHaveBeenCalledWith(
        expect.stringContaining("vector index saved"),
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
