import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../src/shared/chat-types.js";
import {
  groupConversationTurns,
  selectRecentCompleteTurns,
} from "../../src/main/context/conversation-turns.js";

const user = (content: string): ChatMessage => ({ role: "user", content });
const assistant = (content: string): ChatMessage => ({ role: "assistant", content });

describe("conversation turns", () => {
  it("keeps a tool protocol exchange in one complete turn", () => {
    const messages: ChatMessage[] = [
      user("calculate"),
      { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "calculator", arguments: "{}" }] },
      { role: "tool", content: "42", toolCallId: "call_1", name: "calculator" },
      assistant("The answer is 42."),
      user("thanks"),
      assistant("You are welcome."),
    ];

    const turns = groupConversationTurns(messages);

    expect(turns).toHaveLength(2);
    expect(turns[0].messages).toEqual(messages.slice(0, 4));
    expect(turns[1].messages).toEqual(messages.slice(4));
  });

  it("selects newest turns without splitting an oversized turn", () => {
    const turns = groupConversationTurns([
      user("old"), assistant("old answer"),
      user("large"), assistant("x".repeat(200)),
      user("new"), assistant("new answer"),
    ]);
    const estimate = (messages: ChatMessage[]) => messages.reduce((sum, message) => sum + message.content.length, 0);

    expect(selectRecentCompleteTurns(turns, 30, estimate).flatMap(({ messages }) => messages)).toEqual([
      user("new"), assistant("new answer"),
    ]);
  });

  it("ignores orphan protocol messages before the first user message", () => {
    expect(groupConversationTurns([assistant("orphan"), user("hello")])).toEqual([
      { messages: [user("hello")] },
    ]);
  });
});
