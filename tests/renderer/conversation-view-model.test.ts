import { describe, expect, it } from "vitest";
import { createConversationViewModel } from "../../src/renderer/chat/conversation-view-model.js";

describe("conversation view model", () => {
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
