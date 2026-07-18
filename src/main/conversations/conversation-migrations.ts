import { z } from "zod";
import { CONVERSATION_MESSAGE_STATUSES } from "../../shared/conversation-types.js";
import { STYLE_OPTIONS } from "../../shared/persona-types.js";
import {
  CONVERSATION_SCHEMA_VERSION,
  type ConversationRecord,
} from "./conversation-types.js";

const idSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.-]+$/u);
const styleSchema = z.enum(STYLE_OPTIONS.map(({ id }) => id) as [
  (typeof STYLE_OPTIONS)[number]["id"],
  ...(typeof STYLE_OPTIONS)[number]["id"][],
]);
const toolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.string(),
}).strict();
const messageSchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  requestId: idSchema.optional(),
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string(),
  createdAt: z.string().datetime(),
  tokenEstimate: z.number().int().nonnegative(),
  status: z.enum(CONVERSATION_MESSAGE_STATUSES),
  toolCalls: z.array(toolCallSchema).optional(),
  toolCallId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
}).strict().superRefine((message, context) => {
  if (message.role === "tool" && !message.toolCallId) {
    context.addIssue({ code: "custom", message: "tool message requires toolCallId" });
  }
  if (message.role !== "assistant" && message.toolCalls) {
    context.addIssue({ code: "custom", message: "toolCalls require assistant role" });
  }
});
const summarySchema = z.object({
  schemaVersion: z.literal(CONVERSATION_SCHEMA_VERSION),
  overview: z.string(),
  decisions: z.array(z.string()),
  constraints: z.array(z.string()),
  userRequests: z.array(z.string()),
  openTasks: z.array(z.string()),
  importantToolResults: z.array(z.string()),
  entities: z.array(z.string()),
  coveredThroughMessageId: idSchema.optional(),
  sourceMessageCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime().optional(),
}).strict();
const recordSchema = z.object({
  schemaVersion: z.literal(CONVERSATION_SCHEMA_VERSION),
  id: idSchema,
  title: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastMessageAt: z.string().datetime().optional(),
  styleId: styleSchema,
  pendingStyleTransition: z.object({ from: styleSchema, to: styleSchema }).strict().optional(),
  messages: z.array(messageSchema),
  summary: summarySchema,
  pinnedMessageIds: z.array(idSchema),
}).strict().superRefine((record, context) => {
  if (record.messages.some(({ conversationId }) => conversationId !== record.id)) {
    context.addIssue({ code: "custom", message: "message conversation mismatch" });
  }
});

export function migrateConversation(value: unknown): ConversationRecord {
  if (
    typeof value !== "object" || value === null ||
    !("schemaVersion" in value) || value.schemaVersion !== CONVERSATION_SCHEMA_VERSION
  ) {
    throw new Error("CONVERSATION_SCHEMA_UNSUPPORTED");
  }
  const result = recordSchema.safeParse(value);
  if (!result.success) {
    throw new Error("CONVERSATION_SCHEMA_INVALID", { cause: result.error });
  }
  return result.data as ConversationRecord;
}
