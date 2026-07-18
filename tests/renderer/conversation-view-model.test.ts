import { describe, expect, it } from "vitest";
import { createConversationViewModel } from "../../src/renderer/chat/conversation-view-model.js";

describe("conversation view model", () => {
  it("routes ordered deltas by run and ignores duplicate sequences", () => {
    const model = createConversationViewModel("conv_a");
    model.beginRun("conv_a", "req_1");
    model.acceptRun("run_1", "conv_a", "req_1", "running");

    expect(model.applyRunEvent({
      runId: "run_1",
      conversationId: "conv_a",
      requestId: "req_1",
      sequence: 1,
      timestamp: "2026-07-18T00:00:00.000Z",
      event: { type: "text_delta", delta: "Hello" },
    })).toMatchObject({ accepted: true, text: "Hello" });
    expect(model.applyRunEvent({
      runId: "run_1",
      sequence: 1,
      timestamp: "2026-07-18T00:00:00.000Z",
      event: { type: "text_delta", delta: " duplicate" },
    }).accepted).toBe(false);
    expect(model.snapshot().liveRuns[0].text).toBe("Hello");
  });

  it("keeps concurrent conversations isolated and completes one run", () => {
    const model = createConversationViewModel("conv_a");
    model.beginRun("conv_a", "req_a");
    model.acceptRun("run_a", "conv_a", "req_a", "running");
    model.beginRun("conv_b", "req_b");
    model.acceptRun("run_b", "conv_b", "req_b", "queued");

    model.applyRunEvent({
      runId: "run_a", conversationId: "conv_a", requestId: "req_a", sequence: 1,
      timestamp: "2026-07-18T00:00:00.000Z", event: { type: "run_succeeded" },
    });

    expect(model.snapshot().liveRuns.map(({ runId }) => runId)).toEqual(["run_b"]);
    expect(model.snapshot().busy).toBe(false);
  });

  it("routes a result to its source conversation instead of the active one", () => {
    const model = createConversationViewModel("conv_a");
    model.beginRun("conv_a", "req_1");
    model.setActive("conv_b");

    const route = model.finishRun({ conversationId: "conv_a", requestId: "req_1" });

    expect(route.renderInActiveConversation).toBe(false);
    expect(model.snapshot().unreadConversationIds).toEqual(["conv_a"]);
    expect(model.snapshot().busy).toBe(false);
  });

  it("clears unread state when a conversation becomes active", () => {
    const model = createConversationViewModel("conv_a");
    model.beginRun("conv_a", "req_1");
    model.setActive("conv_b");
    model.finishRun({ conversationId: "conv_a", requestId: "req_1" });

    model.setActive("conv_a");

    expect(model.snapshot().unreadConversationIds).toEqual([]);
  });
});
