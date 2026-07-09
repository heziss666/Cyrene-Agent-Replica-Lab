export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  toolCallId?: string;
  name?: string;
}

export function createUserMessage(content: string): ChatMessage {
  return {
    role: "user",
    content,
  };
}
