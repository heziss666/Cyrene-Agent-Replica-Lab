import { describe, expect, it } from "vitest";
import { createChatSession } from "../../src/main/chat/chat-session.js";
import type { ChatMessage } from "../../src/shared/chat-types.js";

describe("createChatSession", () => {
  it("stores conversation history without a system message", () => {
    const session = createChatSession({ styleId: "default" });

    session.appendUserMessage("hello");
    session.replaceMessages([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);

    expect(session.getMessages()).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);
  });

  it("changes style without deleting history and records a pending transition", () => {
    const session = createChatSession({ styleId: "default" });
    session.replaceMessages([
      { role: "user", content: "remember this" },
      { role: "assistant", content: "remembered" },
    ]);

    session.setStyle("healing");

    expect(session.getMessages()).toHaveLength(2);
    expect(session.getStyle()).toBe("healing");
    expect(session.getPendingStyleTransition()).toEqual({
      from: "default",
      to: "healing",
    });
  });

  it("does not create a transition when setting the current style", () => {
    const session = createChatSession({ styleId: "focused" });

    session.setStyle("focused");

    expect(session.getPendingStyleTransition()).toBeUndefined();
  });

  it("keeps the original transition source across repeated changes", () => {
    const session = createChatSession({ styleId: "default" });

    session.setStyle("lively");
    session.setStyle("sweet");

    expect(session.getPendingStyleTransition()).toEqual({
      from: "default",
      to: "sweet",
    });
  });

  it("acknowledges only the transition used by the completed request", () => {
    const session = createChatSession({ styleId: "default" });
    session.setStyle("healing");
    const usedTransition = session.getPendingStyleTransition();

    session.setStyle("sweet");
    session.acknowledgeStyleTransition(usedTransition);

    expect(session.getPendingStyleTransition()).toEqual({
      from: "default",
      to: "sweet",
    });

    session.acknowledgeStyleTransition(session.getPendingStyleTransition());

    expect(session.getPendingStyleTransition()).toBeUndefined();
  });

  it("clears history while preserving the selected style", () => {
    const session = createChatSession({ styleId: "default" });
    session.appendUserMessage("hello");
    session.setStyle("focused");

    session.clear();

    expect(session.getMessages()).toEqual([]);
    expect(session.getStyle()).toBe("focused");
    expect(session.getPendingStyleTransition()).toBeUndefined();
  });

  it("rejects system messages in session-owned history", () => {
    const session = createChatSession({ styleId: "default" });

    expect(() => session.replaceMessages([
      { role: "system", content: "must not persist" },
    ])).toThrow("ChatSession history cannot contain system messages");
  });

  it("uses defensive copies for messages and transitions", () => {
    const input: ChatMessage[] = [{ role: "user", content: "hello" }];
    const session = createChatSession({ styleId: "default" });
    session.replaceMessages(input);
    session.setStyle("healing");

    input[0]!.content = "mutated outside";
    const output = session.getMessages();
    output[0]!.content = "mutated copy";
    const transition = session.getPendingStyleTransition()!;
    transition.to = "sweet";

    expect(session.getMessages()).toEqual([{ role: "user", content: "hello" }]);
    expect(session.getPendingStyleTransition()).toEqual({
      from: "default",
      to: "healing",
    });
  });
});
