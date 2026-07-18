import { describe, expect, it } from "vitest";
import { generateConversationTitle } from "../../src/main/conversations/conversation-title.js";

describe("generateConversationTitle", () => {
  it("normalizes the first user message into a short title", () => {
    expect(generateConversationTitle("  ？？请详细解释   Agent 的记忆冲突处理流程和代码  ")).toBe(
      "请详细解释 Agent 的记忆冲突处理流程和代码",
    );
    expect([...generateConversationTitle("一".repeat(40))]).toHaveLength(24);
  });

  it("falls back for punctuation-only input", () => {
    expect(generateConversationTitle("？！... ")).toBe("New Chat");
  });
});
