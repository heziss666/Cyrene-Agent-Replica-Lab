import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConversationVectorIndex } from "../../src/main/context/conversation-vector-index.js";

const roots: string[] = [];
async function pathForTest() {
  const root = await mkdtemp(join(tmpdir(), "cyrene-conv-vector-"));
  roots.push(root);
  return join(root, "index.json");
}
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("conversation vector index", () => {
  it("persists and reloads scoped entries", async () => {
    const filePath = await pathForTest();
    const first = createConversationVectorIndex({ filePath, providerId: "ollama", model: "embed" });
    expect((await first.initialize()).status).toBe("missing");
    await first.addMany([{ conversationId: "a", chunkId: "c1", textHash: "h1", vector: [1, 0] }]);

    const second = createConversationVectorIndex({ filePath, providerId: "ollama", model: "embed" });
    expect((await second.initialize()).status).toBe("loaded");
    expect(second.get("a", "c1", "h1")).toEqual([1, 0]);
  });

  it("prunes only the selected conversation", async () => {
    const index = createConversationVectorIndex({ filePath: await pathForTest(), providerId: "ollama", model: "embed" });
    await index.initialize();
    await index.addMany([
      { conversationId: "a", chunkId: "old", textHash: "h1", vector: [1] },
      { conversationId: "a", chunkId: "keep", textHash: "h2", vector: [1] },
      { conversationId: "b", chunkId: "other", textHash: "h3", vector: [1] },
    ]);

    expect(await index.pruneConversation("a", [{ chunkId: "keep", textHash: "h2" }])).toBe(1);
    expect(index.get("a", "old", "h1")).toBeUndefined();
    expect(index.get("b", "other", "h3")).toEqual([1]);
  });

  it("removes one conversation and rejects mixed vector dimensions", async () => {
    const index = createConversationVectorIndex({ filePath: await pathForTest(), providerId: "ollama", model: "embed" });
    await index.initialize();
    await index.addMany([{ conversationId: "a", chunkId: "c1", textHash: "h1", vector: [1, 2] }]);
    await expect(index.addMany([{ conversationId: "b", chunkId: "c2", textHash: "h2", vector: [1] }])).rejects.toThrow("CONVERSATION_VECTOR_DIMENSIONS_INVALID");
    expect(await index.removeConversation("a")).toBe(1);
  });

  it("reports incompatible identity without loading old entries", async () => {
    const filePath = await pathForTest();
    const first = createConversationVectorIndex({ filePath, providerId: "ollama", model: "old" });
    await first.initialize();
    await first.addMany([{ conversationId: "a", chunkId: "c1", textHash: "h1", vector: [1] }]);

    const second = createConversationVectorIndex({ filePath, providerId: "ollama", model: "new" });
    expect((await second.initialize()).status).toBe("incompatible");
    expect(second.get("a", "c1", "h1")).toBeUndefined();
  });

  it("recovers from corrupt derived data", async () => {
    const filePath = await pathForTest();
    await writeFile(filePath, "{broken", "utf8");
    const index = createConversationVectorIndex({ filePath, providerId: "ollama", model: "embed" });

    expect((await index.initialize()).status).toBe("corrupt");
    await index.addMany([{ conversationId: "a", chunkId: "c1", textHash: "h1", vector: [1] }]);
    expect(JSON.parse(await readFile(filePath, "utf8")).entries).toHaveLength(1);
  });
});
