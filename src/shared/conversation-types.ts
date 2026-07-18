import type { StyleId } from "./persona-types.js";

export const CONVERSATION_MESSAGE_STATUSES = [
  "pending",
  "complete",
  "failed",
] as const;

export type ConversationMessageStatus =
  (typeof CONVERSATION_MESSAGE_STATUSES)[number];

export function isConversationMessageStatus(
  value: unknown,
): value is ConversationMessageStatus {
  return CONVERSATION_MESSAGE_STATUSES.some((status) => status === value);
}

export interface ConversationSummaryView {
  overview: string;
  decisions: string[];
  constraints: string[];
  userRequests: string[];
  openTasks: string[];
  importantToolResults: string[];
  entities: string[];
  sourceMessageCount: number;
  updatedAt?: string;
}

export interface ConversationMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status: ConversationMessageStatus;
  isPinned: boolean;
}

export interface ConversationListItem {
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

export interface ConversationDetail extends ConversationListItem {
  messages: ConversationMessageView[];
  summary: ConversationSummaryView;
}

export interface ConversationSendInput {
  conversationId: string;
  requestId: string;
  text: string;
}

export interface ConversationCreateResult {
  conversation: ConversationDetail;
}

export interface ConversationListResult {
  activeConversationId: string;
  conversations: ConversationListItem[];
}

export interface ConversationGetInput {
  conversationId: string;
}

export interface ConversationSetActiveInput extends ConversationGetInput {}

export interface ConversationRenameInput extends ConversationGetInput {
  title: string;
}

export interface ConversationDeleteInput extends ConversationGetInput {}

export interface ConversationSetMessagePinnedInput extends ConversationGetInput {
  messageId: string;
  pinned: boolean;
}

export interface ConversationMutationResult {
  activeConversationId: string;
  conversation?: ConversationDetail;
}

export interface ConversationChangedPayload {
  activeConversationId: string;
  conversations: ConversationListItem[];
}
