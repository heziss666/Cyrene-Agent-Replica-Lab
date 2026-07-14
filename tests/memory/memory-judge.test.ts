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

  it("tells the model that importance must use the allowed string enum", async () => {
    const { judge, requestCompletion } = judgeReturning('{"candidates":[]}');

    await judge.judge({ userMessage: "Call me Alex", assistantReply: "Hello" });

    const systemMessage = requestCompletion.mock.calls[0]![0].messages[0];
    expect(systemMessage?.content).toContain(
      'importance must be exactly one of the JSON strings: "low", "medium", or "high"',
    );
  });

  it("defines the semantic boundary between L0, L1, and L2", async () => {
    const { judge, requestCompletion } = judgeReturning('{"candidates":[]}');

    await judge.judge({ userMessage: "I reached a milestone", assistantReply: "Great" });

    const prompt = requestCompletion.mock.calls[0]![0].messages[0]?.content;
    expect(prompt).toContain("L0 stores stable profile facts");
    expect(prompt).toContain("L1 stores current or recent state");
    expect(prompt).toContain("L2 stores specific past events or milestones");
    expect(prompt).toContain("L2 candidates must omit field");
  });

  it("requires confidence to be a numeric probability", async () => {
    const { judge, requestCompletion } = judgeReturning('{"candidates":[]}');

    await judge.judge({ userMessage: "I reached a milestone", assistantReply: "Great" });

    const prompt = requestCompletion.mock.calls[0]![0].messages[0]?.content;
    expect(prompt).toContain(
      "confidence must be a JSON number from 0 to 1, never a word or string",
    );
    expect(prompt).toContain(
      '{"layer":"L2","content":"Completed milestone Alpha-7","confidence":0.95',
    );
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

  it("normalizes a null L2 field to an omitted optional field", async () => {
    const l2Candidate = {
      layer: "L2",
      field: null,
      content: "The user reached milestone Alpha-7",
      confidence: 0.9,
      importance: "high",
      evidenceQuote: "I reached milestone Alpha-7",
      reason: "A durable past event",
    };
    const { judge } = judgeReturning(JSON.stringify({ candidates: [l2Candidate] }));
    const { field: _field, ...expectedCandidate } = l2Candidate;

    await expect(judge.judge({
      userMessage: "I reached milestone Alpha-7",
      assistantReply: "Congratulations",
    })).resolves.toEqual([expectedCandidate]);
  });
});
