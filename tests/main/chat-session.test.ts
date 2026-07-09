import { describe, expect, it } from "vitest";
import { createChatSession } from "../../src/main/chat/chat-session.js";
import type { ChatMessage } from "../../src/shared/chat-types.js";

describe("createChatSession", () => {
  it("keeps multi-turn messages and clears back to the initial history", () => {
    const initialMessages: ChatMessage[] = [{ role: "system", content: "system prompt" }];
    const session = createChatSession(initialMessages);

    expect(session.getMessages()).toEqual([{ role: "system", content: "system prompt" }]);

    session.appendUserMessage("hello");
    expect(session.getMessages()).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "hello" },
    ]);

    session.replaceMessages([
      { role: "system", content: "system prompt" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);
    expect(session.getMessages()).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);

    session.clear();
    expect(session.getMessages()).toEqual([{ role: "system", content: "system prompt" }]);
  });

  it("uses defensive copies for input and output messages", () => {
    const initialMessages: ChatMessage[] = [{ role: "system", content: "system prompt" }];
    const session = createChatSession(initialMessages);

    initialMessages[0]!.content = "mutated outside";
    expect(session.getMessages()).toEqual([{ role: "system", content: "system prompt" }]);

    const messages = session.getMessages();
    messages.push({ role: "user", content: "mutated copy" });
    messages[0]!.content = "mutated copy";

    expect(session.getMessages()).toEqual([{ role: "system", content: "system prompt" }]);
  });
});
