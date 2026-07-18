import type { AgentEvent } from "../main/agent/agent-events.js";
import type { MemoryApi } from "./memory-api-types.js";
import type { StyleId } from "./persona-types.js";
import type { SkillsApi } from "./skill-api-types.js";
import type { McpApi } from "./mcp-api-types.js";
import type { SchedulerApi } from "./scheduler-api-types.js";
import type { ConversationsApi } from "./conversation-types.js";

export interface ChatSendResult {
  reply: string;
  runId: string;
  conversationId?: string;
  requestId?: string;
  messageCount: number;
  toolResultCount: number;
}

export interface ChatClearResult {
  cleared: true;
  messageCount: number;
}

export interface ChatAgentEventPayload {
  runId: string;
  conversationId?: string;
  requestId?: string;
  event: AgentEvent;
}

export type AgentEventListener = (payload: ChatAgentEventPayload) => void;

export interface PersonaStyleResult {
  styleId: StyleId;
}

export interface MemoryMaintenanceRunResult {
  runId: string;
}

export interface CyreneApi {
  conversations: ConversationsApi;
  chat: {
    sendMessage: (text: string) => Promise<ChatSendResult>;
    clearSession: () => Promise<ChatClearResult>;
    onAgentEvent: (listener: AgentEventListener) => () => void;
  };
  persona: {
    getStyle: () => Promise<PersonaStyleResult>;
    setStyle: (styleId: StyleId) => Promise<PersonaStyleResult>;
  };
  memory: MemoryApi & {
    runMaintenance: () => Promise<MemoryMaintenanceRunResult>;
  };
  skills: SkillsApi;
  mcp: McpApi;
  scheduler: SchedulerApi;
}
