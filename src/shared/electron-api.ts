import type { AgentEvent } from "../main/agent/agent-events.js";

export interface ChatSendResult {
  reply: string;
  runId: string;
  messageCount: number;
  toolResultCount: number;
}

export interface ChatClearResult {
  cleared: true;
  messageCount: number;
}

export interface ChatAgentEventPayload {
  runId: string;
  event: AgentEvent;
}

export type AgentEventListener = (payload: ChatAgentEventPayload) => void;

export interface CyreneApi {
  chat: {
    sendMessage: (text: string) => Promise<ChatSendResult>;
    clearSession: () => Promise<ChatClearResult>;
    onAgentEvent: (listener: AgentEventListener) => () => void;
  };
}
