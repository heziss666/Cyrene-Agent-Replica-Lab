import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyConversation, type ConversationRecord } from "../../src/main/conversations/conversation-types.js";
import { createConversationHistoryRetriever } from "../../src/main/context/conversation-history-retriever.js";
import { createConversationVectorIndex } from "../../src/main/context/conversation-vector-index.js";

const roots: string[] = [];
async function setup(provider: { embedDocuments(texts: string[]): Promise<number[][]>; embedQuery(query: string): Promise<number[]> }) {
  const root = await mkdtemp(join(tmpdir(), "cyrene-history-"));
  roots.push(root);
  const index = createConversationVectorIndex({ filePath: join(root, "vectors.json"), providerId: "fake", model: "fake" });
  await index.initialize();
  return createConversationHistoryRetriever({ provider: { id: "fake", model: "fake", ...provider }, index, chunkSizeChars: 200 });
}

function history(): ConversationRecord {
  const record = createEmptyConversation({ id: "conv_a", styleId: "default", now: "2026-07-18T00:00:00.000Z" });
  const add = (id: string, role: "user" | "assistant" | "tool", content: string, extra = {}) => record.messages.push({ id, conversationId: record.id, role, content, createdAt: `2026-07-18T00:00:0${record.messages.length}.000Z`, tokenEstimate: 5, status: "complete", ...extra });
  add("u_tools", "user", "ToolRegistry 在哪里注册？");
  add("a_call", "assistant", "", { toolCalls: [{ id: "call_1", name: "search_knowledge", arguments: "{}" }] });
  add("t_secret", "tool", "SECRET_RAW_TOOL_RESULT", { toolCallId: "call_1", name: "search_knowledge" });
  add("a_tools", "assistant", "ToolRegistry 在运行时保存并执行工具。");
  add("u_weather", "user", "今天天气如何？");
  add("a_weather", "assistant", "今天晴朗。");
  return record;
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("conversation history retriever", () => {
  it("indexes complete turns without raw tool outputs and retrieves semantic matches", async () => {
    const embedded: string[] = [];
    const retriever = await setup({
      embedDocuments: async (texts) => {
        embedded.push(...texts);
        return texts.map((text) => text.includes("ToolRegistry") ? [1, 0] : [0, 1]);
      },
      embedQuery: async () => [1, 0],
    });
    const record = history();

    await retriever.indexConversation(record);
    const result = await retriever.retrieve({ record, query: "工具注册机制", recentMessageIds: new Set(), pinnedMessageIds: new Set(), topK: 4 });

    expect(embedded.join("\n")).toContain("search_knowledge");
    expect(embedded.join("\n")).not.toContain("SECRET_RAW_TOOL_RESULT");
    expect(result.mode).toBe("hybrid");
    expect(result.excerpts[0]).toMatchObject({ conversationId: "conv_a", turnId: "u_tools" });
  });

  it("excludes recent and pinned messages and never crosses conversations", async () => {
    const retriever = await setup({ embedDocuments: async (texts) => texts.map(() => [1]), embedQuery: async () => [1] });
    const record = history();
    await retriever.indexConversation(record);

    const result = await retriever.retrieve({ record, query: "ToolRegistry", recentMessageIds: new Set(["u_tools"]), pinnedMessageIds: new Set(), topK: 4 });

    expect(result.excerpts.every(({ messageIds }) => !messageIds.includes("u_tools"))).toBe(true);
    expect(result.excerpts.every(({ conversationId }) => conversationId === "conv_a")).toBe(true);
  });

  it("falls back to keyword retrieval when query embedding fails", async () => {
    const retriever = await setup({ embedDocuments: async (texts) => texts.map(() => [1]), embedQuery: vi.fn(async () => { throw new Error("offline"); }) });
    const record = history();
    await retriever.indexConversation(record);

    const result = await retriever.retrieve({ record, query: "ToolRegistry", recentMessageIds: new Set(), pinnedMessageIds: new Set(), topK: 4 });

    expect(result.mode).toBe("keyword");
    expect(result.excerpts[0].turnId).toBe("u_tools");
  });
});
