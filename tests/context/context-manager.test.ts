import { describe, expect, it, vi } from "vitest";
import { createEmptyConversation, type ConversationRecord } from "../../src/main/conversations/conversation-types.js";
import { createContextManager } from "../../src/main/context/context-manager.js";
import { createConservativeTokenEstimator } from "../../src/main/context/token-estimator.js";

function record(): ConversationRecord {
  const value = createEmptyConversation({ id: "conv_1", styleId: "default", now: "2026-07-18T00:00:00.000Z" });
  const add = (id: string, role: "user" | "assistant" | "tool", content: string, extra = {}) => value.messages.push({ id, conversationId: value.id, role, content, createdAt: value.createdAt, tokenEstimate: 4, status: "complete", ...extra });
  add("u_old", "user", "old architecture question");
  add("a_old", "assistant", "old architecture answer");
  add("u_recent", "user", "calculate 6 * 7");
  add("a_call", "assistant", "", { toolCalls: [{ id: "call_1", name: "calculator", arguments: "{}" }] });
  add("t_result", "tool", "42", { toolCallId: "call_1", name: "calculator" });
  add("a_recent", "assistant", "The result is 42.");
  value.messages.push({ id: "u_current", conversationId: value.id, requestId: "req_1", role: "user", content: "How does that tool work?", createdAt: value.createdAt, tokenEstimate: 6, status: "pending" });
  return value;
}

function manager(overrides: { contextWindowTokens?: number; retrieve?: (...args: never[]) => Promise<unknown> } = {}) {
  const retrieve = overrides.retrieve ?? vi.fn(async () => ({ mode: "hybrid", excerpts: [{ conversationId: "conv_1", turnId: "u_old", chunkId: "u_old_part_1", messageIds: ["u_old", "a_old"], text: "User: old architecture question\nAssistant: old architecture answer", createdAt: "2026-07-18T00:00:00.000Z", score: 1 }] }));
  return createContextManager({
    estimator: createConservativeTokenEstimator(),
    historyRetriever: { retrieve } as never,
    contextWindowTokens: overrides.contextWindowTokens ?? 500,
    outputReserveTokens: 50,
    toolGrowthReserveTokens: 50,
    recentTurnTokens: 150,
    summaryTriggerTokens: 100,
  });
}

describe("context manager", () => {
  it("keeps mandatory input and complete recent tool turns", async () => {
    const result = await manager().build({ record: record(), systemPrompt: "SYSTEM", tools: [], currentRequestId: "req_1" });

    expect(result.messages[0]).toMatchObject({ role: "system" });
    expect(result.messages.at(-1)).toEqual({ role: "user", content: "How does that tool work?" });
    expect(result.messages.some(({ toolCalls }) => toolCalls?.[0]?.id === "call_1")).toBe(true);
    expect(result.messages.some(({ toolCallId }) => toolCallId === "call_1")).toBe(true);
    expect(result.estimatedInputTokens).toBeLessThanOrEqual(result.inputBudgetTokens);
  });

  it("does not retrieve turns already present in the recent window", async () => {
    const retrieve = vi.fn(async (_input: unknown) => ({ mode: "hybrid", excerpts: [] }));
    await manager({ retrieve: retrieve as never }).build({ record: record(), systemPrompt: "SYSTEM", tools: [], currentRequestId: "req_1" });

    const input = retrieve.mock.calls[0][0] as { recentMessageIds: Set<string> };
    expect(input.recentMessageIds.has("u_recent")).toBe(true);
    expect(input.recentMessageIds.has("t_result")).toBe(true);
  });

  it("includes structured summary as background and recommends refresh by threshold", async () => {
    const value = record();
    value.summary.overview = "The session is about agent architecture.";
    const result = await manager().build({ record: value, systemPrompt: "SYSTEM", tools: [], currentRequestId: "req_1" });

    expect(result.messages[0].content).toContain("Session summary");
    expect(result.messages[0].content).toContain(value.summary.overview);
    expect(typeof result.summaryRecommended).toBe("boolean");
  });

  it("rejects pinned content that cannot fit instead of silently removing it", async () => {
    const value = record();
    value.messages[0].content = "很".repeat(300);
    value.pinnedMessageIds = [value.messages[0].id];

    await expect(manager({ contextWindowTokens: 180 }).build({ record: value, systemPrompt: "SYSTEM", tools: [], currentRequestId: "req_1" })).rejects.toThrow(
      "CONVERSATION_PINNED_CONTENT_EXCEEDS_BUDGET",
    );
  });
});
