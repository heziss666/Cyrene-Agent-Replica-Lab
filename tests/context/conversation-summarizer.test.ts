import { describe, expect, it, vi } from "vitest";
import { createEmptyConversation, type ConversationRecord } from "../../src/main/conversations/conversation-types.js";
import { createConversationSummarizer } from "../../src/main/context/conversation-summarizer.js";
import { createConservativeTokenEstimator } from "../../src/main/context/token-estimator.js";

function recordWithTurns(count: number): ConversationRecord {
  const record = createEmptyConversation({ id: "conv_1", styleId: "default", now: "2026-07-18T00:00:00.000Z" });
  for (let index = 1; index <= count; index += 1) {
    record.messages.push({ id: `u_${index}`, conversationId: record.id, role: "user", content: `question ${index} ${"x".repeat(20)}`, createdAt: record.createdAt, tokenEstimate: 8, status: "complete" });
    record.messages.push({ id: `a_${index}`, conversationId: record.id, role: "assistant", content: `answer ${index} ${"y".repeat(20)}`, createdAt: record.createdAt, tokenEstimate: 8, status: "complete" });
  }
  return record;
}

const valid = {
  overview: "The user is studying agents.",
  decisions: ["Use JSON persistence"],
  constraints: ["Keep raw history"],
  userRequests: ["Add sessions"],
  openTasks: ["Build retrieval"],
  importantToolResults: [],
  entities: ["Agent"],
};

describe("conversation summarizer", () => {
  it("triggers only after unsummarized content reaches the threshold", () => {
    const summarizer = createConversationSummarizer({ estimator: createConservativeTokenEstimator(), triggerTokens: 20, recentTurnTokens: 10, requestCompletion: vi.fn() as never, getConfig: vi.fn() as never, adapter: {} as never });
    expect(summarizer.shouldSummarize(recordWithTurns(0))).toBe(false);
    expect(summarizer.shouldSummarize(recordWithTurns(3))).toBe(true);
  });

  it("sends the previous summary and only uncovered old messages", async () => {
    const record = recordWithTurns(4);
    record.summary.overview = "Previous overview";
    record.summary.coveredThroughMessageId = "a_1";
    record.summary.sourceMessageCount = 2;
    const requestCompletion = vi.fn(async (_input: unknown) => ({ text: JSON.stringify(valid) }));
    const summarizer = createConversationSummarizer({ estimator: createConservativeTokenEstimator(), triggerTokens: 1, recentTurnTokens: 20, requestCompletion: requestCompletion as never, getConfig: () => ({ provider: "test", baseUrl: "https://example.test", model: "test", apiKey: "key" }), adapter: {} as never, now: () => "2026-07-18T01:00:00.000Z" });

    const result = await summarizer.summarize(record);

    expect(result.status).toBe("updated");
    expect(result.summary.overview).toBe(valid.overview);
    expect(result.summary.coveredThroughMessageId).toBe("a_3");
    const request = requestCompletion.mock.calls[0][0] as { messages: Array<{ content: string }>; tools: unknown[] };
    expect(request.tools).toEqual([]);
    expect(request.messages[1].content).toContain("Previous overview");
    expect(request.messages[1].content).not.toContain("question 1");
    expect(request.messages[1].content).not.toContain("question 4");
    expect(request.messages[1].content).toContain("question 2");
  });

  it("keeps the old summary when model output is invalid", async () => {
    const record = recordWithTurns(3);
    record.summary.overview = "Keep me";
    const summarizer = createConversationSummarizer({ estimator: createConservativeTokenEstimator(), triggerTokens: 1, recentTurnTokens: 10, requestCompletion: (async () => ({ text: "not json" })) as never, getConfig: (() => ({})) as never, adapter: {} as never });

    const result = await summarizer.summarize(record);

    expect(result).toMatchObject({ status: "failed", code: "CONVERSATION_SUMMARY_INVALID" });
    expect(result.summary).toEqual(record.summary);
  });

  it("skips when there are no old turns outside the protected recent window", async () => {
    const record = recordWithTurns(1);
    const requestCompletion = vi.fn();
    const summarizer = createConversationSummarizer({ estimator: createConservativeTokenEstimator(), triggerTokens: 1, recentTurnTokens: 10_000, requestCompletion: requestCompletion as never, getConfig: (() => ({})) as never, adapter: {} as never });

    expect(await summarizer.summarize(record)).toMatchObject({ status: "skipped" });
    expect(requestCompletion).not.toHaveBeenCalled();
  });
});
