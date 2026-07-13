import type { ChatMessage } from "../../shared/chat-types.js";
import { createUserMessage } from "../../shared/chat-types.js";
import type {
  StyleId,
  StyleTransition,
} from "../../shared/persona-types.js";

export interface ChatSession {
  getMessages: () => ChatMessage[];
  appendUserMessage: (text: string) => ChatMessage[];
  replaceMessages: (messages: ChatMessage[]) => void;
  clear: () => void;
  getStyle: () => StyleId;
  setStyle: (styleId: StyleId) => void;
  getPendingStyleTransition: () => StyleTransition | undefined;
  acknowledgeStyleTransition: () => void;
}

function cloneMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
  };
}

function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(cloneMessage);
}

function assertHistoryMessages(messages: ChatMessage[]): void {
  if (messages.some((message) => message.role === "system")) {
    throw new Error("ChatSession history cannot contain system messages");
  }
}

export function createChatSession(input: { styleId: StyleId }): ChatSession {
  let messages: ChatMessage[] = [];
  let activeStyle = input.styleId;
  let pendingTransition: StyleTransition | undefined;

  return {
    getMessages: () => cloneMessages(messages),
    appendUserMessage: (text) => {
      messages.push(createUserMessage(text));
      return cloneMessages(messages);
    },
    replaceMessages: (nextMessages) => {
      assertHistoryMessages(nextMessages);
      messages = cloneMessages(nextMessages);
    },
    clear: () => {
      messages = [];
      pendingTransition = undefined;
    },
    getStyle: () => activeStyle,
    setStyle: (styleId) => {
      if (styleId === activeStyle) return;
      const from = pendingTransition?.from ?? activeStyle;
      activeStyle = styleId;
      pendingTransition = styleId === from ? undefined : { from, to: styleId };
    },
    getPendingStyleTransition: () => pendingTransition
      ? { ...pendingTransition }
      : undefined,
    acknowledgeStyleTransition: () => {
      pendingTransition = undefined;
    },
  };
}
