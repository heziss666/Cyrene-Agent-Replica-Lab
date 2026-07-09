import type { ChatMessage } from "../../shared/chat-types.js";
import { createUserMessage } from "../../shared/chat-types.js";

export interface ChatSession {
  getMessages: () => ChatMessage[];
  appendUserMessage: (text: string) => ChatMessage[];
  replaceMessages: (messages: ChatMessage[]) => void;
  clear: () => void;
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

export function createChatSession(initialMessages: ChatMessage[]): ChatSession {
  const initial = cloneMessages(initialMessages);
  let messages = cloneMessages(initial);

  return {
    getMessages: () => cloneMessages(messages),
    appendUserMessage: (text) => {
      messages.push(createUserMessage(text));
      return cloneMessages(messages);
    },
    replaceMessages: (nextMessages) => {
      messages = cloneMessages(nextMessages);
    },
    clear: () => {
      messages = cloneMessages(initial);
    },
  };
}
