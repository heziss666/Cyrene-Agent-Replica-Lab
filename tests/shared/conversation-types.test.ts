import { describe, expect, it } from "vitest";
import {
  CONVERSATION_MESSAGE_STATUSES,
  isConversationMessageStatus,
} from "../../src/shared/conversation-types.js";

describe("conversation types", () => {
  it("recognizes only supported persisted message statuses", () => {
    expect(CONVERSATION_MESSAGE_STATUSES).toEqual([
      "pending", "streaming", "complete", "cancelled", "failed",
    ]);
    expect(isConversationMessageStatus("pending")).toBe(true);
    expect(isConversationMessageStatus("complete")).toBe(true);
    expect(isConversationMessageStatus("streaming")).toBe(true);
    expect(isConversationMessageStatus("cancelled")).toBe(true);
    expect(isConversationMessageStatus("failed")).toBe(true);
    expect(isConversationMessageStatus("running")).toBe(false);
    expect(isConversationMessageStatus(null)).toBe(false);
  });
});
