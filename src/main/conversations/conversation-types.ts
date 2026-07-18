import type { ChatMessage } from "../../shared/chat-types.js";
import type { ConversationMessageStatus } from "../../shared/conversation-types.js";
import type { StyleId, StyleTransition } from "../../shared/persona-types.js";

export const CONVERSATION_SCHEMA_VERSION = 1 as const;

export interface ConversationMessage {
  id: string;
  conversationId: string;
  requestId?: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  tokenEstimate: number;
  status: ConversationMessageStatus;
  toolCalls?: ChatMessage["toolCalls"];
  toolCallId?: string;
  name?: string;
}

export interface ConversationSummary {
  schemaVersion: typeof CONVERSATION_SCHEMA_VERSION;
  overview: string;
  decisions: string[];
  constraints: string[];
  userRequests: string[];
  openTasks: string[];
  importantToolResults: string[];
  entities: string[];
  coveredThroughMessageId?: string;
  sourceMessageCount: number;
  updatedAt?: string;
}

export interface ConversationRecord {
  schemaVersion: typeof CONVERSATION_SCHEMA_VERSION;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  styleId: StyleId;
  pendingStyleTransition?: StyleTransition;
  messages: ConversationMessage[];
  summary: ConversationSummary;
  pinnedMessageIds: string[];
}

export interface ConversationIndexEntry {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  styleId: StyleId;
  messageCount: number;
  hasPendingRun: boolean;
}

export interface ConversationIndexFile {
  schemaVersion: typeof CONVERSATION_SCHEMA_VERSION;
  activeConversationId?: string;
  conversations: ConversationIndexEntry[];
}

export function createEmptyConversation(input: {
  id: string;
  styleId: StyleId;
  now: string;
}): ConversationRecord {
  return {
    schemaVersion: CONVERSATION_SCHEMA_VERSION,
    id: input.id,
    title: "New Chat",
    createdAt: input.now,
    updatedAt: input.now,
    styleId: input.styleId,
    messages: [],
    summary: {
      schemaVersion: CONVERSATION_SCHEMA_VERSION,
      overview: "",
      decisions: [],
      constraints: [],
      userRequests: [],
      openTasks: [],
      importantToolResults: [],
      entities: [],
      sourceMessageCount: 0,
    },
    pinnedMessageIds: [],
  };
}

export function toChatMessages(messages: ConversationMessage[]): ChatMessage[] {
  return messages
    .filter(({ status }) => status === "complete")
    .map(({ role, content, toolCalls, toolCallId, name }) => ({
      role,
      content,
      ...(toolCalls ? { toolCalls: toolCalls.map((call) => ({ ...call })) } : {}),
      ...(toolCallId ? { toolCallId } : {}),
      ...(name ? { name } : {}),
    }));
}

export function toIndexEntry(record: ConversationRecord): ConversationIndexEntry {
  const visible = [...record.messages]
    .reverse()
    .find(({ role, content }) => role !== "tool" && content.trim().length > 0);
  return {
    id: record.id,
    title: record.title,
    preview: visible?.content.trim().slice(0, 120) ?? "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastMessageAt: record.lastMessageAt,
    styleId: record.styleId,
    messageCount: record.messages.length,
    hasPendingRun: record.messages.some(({ status }) => status === "pending"),
  };
}
