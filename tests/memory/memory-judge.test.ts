import { describe, expect, it, vi } from "vitest";
import { createMemoryJudge } from "../../src/main/memory/memory-judge.js";
import type { ModelConfig } from "../../src/main/config/model-config.js";
import type { RequestChatCompletionInput } from "../../src/main/vendors/chat-completion-client.js";
import type { VendorAdapter } from "../../src/main/vendors/types.js";

const config: ModelConfig = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  apiKey: "sk-test",
};

const validCandidate = {
  layer: "L0" as const,
  field: "preferredName",
  content: "Alex",
  confidence: 0.98,
  importance: "high" as const,
  evidenceQuote: "Call me Alex",
  reason: "explicit stable fact",
};

function judgeReturning(text: string) {
  const requestCompletion = vi.fn(async (_input: RequestChatCompletionInput) => ({
    assistantMessage: { role: "assistant" as const, content: text },
    text,
    finishReason: "stop",
    toolCalls: [],
  }));
  const adapter = {
    id: "fake",
    buildRequest: vi.fn(),
    parseResponse: vi.fn(),
    appendToolResults: vi.fn(),
  } as unknown as VendorAdapter;

  return {
    judge: createMemoryJudge({
      getConfig: () => config,
      adapter,
      requestCompletion,
    }),
    requestCompletion,
  };
}

describe("createMemoryJudge", () => {
  it("parses candidates from a JSON object", async () => {
    const { judge, requestCompletion } = judgeReturning(JSON.stringify({ candidates: [validCandidate] }));
    await expect(judge.judge({
      userMessage: "Call me Alex",
      assistantReply: "Hello, Alex.",
    })).resolves.toEqual([validCandidate]);

    expect(requestCompletion).toHaveBeenCalledOnce();
    const request = requestCompletion.mock.calls[0]![0];
    expect(request.messages).toHaveLength(2);
    expect(request.tools).toEqual([]);
    expect(request.messages[0]).toMatchObject({ role: "system" });
    expect(request.messages[0]!.content).toContain("Return JSON");
    for (const field of [
      "preferredName", "occupation", "longTermInterests", "language", "permanentNotes",
      "currentProject", "recentGoals", "recentPreferences",
    ]) {
      expect(request.messages[0]!.content).toContain(field);
    }
  });

  it("accepts an empty candidates array", async () => {
    const { judge } = judgeReturning('{"candidates":[]}');
    await expect(judge.judge({ userMessage: "Hi", assistantReply: "Hello" }))
      .resolves.toEqual([]);
  });

  it("rejects an envelope with extra top-level keys", async () => {
    const { judge } = judgeReturning('{"candidates":[],"unexpected":true}');
    await expect(judge.judge({ userMessage: "Hi", assistantReply: "Hello" }))
      .rejects.toThrow("Invalid memory judge response");
  });

  it("rejects malformed JSON", async () => {
    const { judge } = judgeReturning("not-json");
    await expect(judge.judge({ userMessage: "Hi", assistantReply: "Hello" }))
      .rejects.toThrow("Invalid memory judge response");
  });

  it("filters candidates with invalid layer or confidence", async () => {
    const { judge } = judgeReturning(JSON.stringify({
      candidates: [
        validCandidate,
        { ...validCandidate, layer: "L9" },
        { ...validCandidate, confidence: 2 },
      ],
    }));
    await expect(judge.judge({ userMessage: "Call me Alex", assistantReply: "Hello" }))
      .resolves.toEqual([validCandidate]);
  });
});
