import { randomUUID } from "node:crypto";
import type { ChatMessage } from "../../shared/chat-types.js";
import type { ConversationListResult } from "../../shared/conversation-types.js";
import type { StyleId, StyleTransition } from "../../shared/persona-types.js";
import { generateConversationTitle } from "./conversation-title.js";
import type { ConversationStore } from "./conversation-store.js";
import {
  createEmptyConversation,
  type ConversationMessage,
  type ConversationRecord,
  type ConversationSummary,
} from "./conversation-types.js";

export interface ConversationService {
  initialize(defaultStyleId: StyleId): Promise<ConversationListResult>;
  list(): Promise<ConversationListResult>;
  get(id: string): Promise<ConversationRecord>;
  create(styleId: StyleId): Promise<ConversationRecord>;
  setActive(id: string): Promise<ConversationRecord>;
  rename(id: string, title: string): Promise<ConversationRecord>;
  remove(id: string, fallbackStyleId: StyleId): Promise<ConversationListResult>;
  appendPendingUserMessage(input: {
    conversationId: string;
    requestId: string;
    text: string;
    tokenEstimate: number;
  }): Promise<ConversationRecord>;
  completeRun(conversationId: string, requestId: string, generated: ChatMessage[]): Promise<ConversationRecord>;
  failRun(conversationId: string, requestId: string): Promise<ConversationRecord>;
  setStyle(id: string, styleId: StyleId): Promise<ConversationRecord>;
  acknowledgeStyleTransition(id: string, transition?: StyleTransition): Promise<ConversationRecord>;
  setMessagePinned(id: string, messageId: string, pinned: boolean): Promise<ConversationRecord>;
  clearMessages(id: string): Promise<ConversationRecord>;
  updateSummary(id: string, summary: ConversationSummary): Promise<ConversationRecord>;
  flush(): Promise<void>;
}

export function createConversationService(options: {
  store: ConversationStore;
  idFactory?: (prefix: "conv" | "msg") => string;
  now?: () => string;
}): ConversationService {
  const idFactory = options.idFactory ?? ((prefix) => `${prefix}_${randomUUID()}`);
  const now = options.now ?? (() => new Date().toISOString());
  const mutationTails = new Map<string, Promise<void>>();

  async function requireRecord(id: string): Promise<ConversationRecord> {
    const record = await options.store.load(id);
    if (!record) throw new Error("CONVERSATION_NOT_FOUND");
    return record;
  }

  function mutate(
    id: string,
    change: (record: ConversationRecord) => void,
  ): Promise<ConversationRecord> {
    const previous = mutationTails.get(id) ?? Promise.resolve();
    let output!: ConversationRecord;
    const operation = previous.then(async () => {
      const record = await requireRecord(id);
      change(record);
      record.updatedAt = now();
      await options.store.save(record);
      output = structuredClone(record);
    });
    const settled = operation.catch(() => undefined);
    mutationTails.set(id, settled);
    void settled.finally(() => {
      if (mutationTails.get(id) === settled) mutationTails.delete(id);
    });
    return operation.then(() => output);
  }

  async function list(): Promise<ConversationListResult> {
    const conversations = await options.store.list();
    const activeConversationId = await options.store.getActiveId();
    if (!activeConversationId) throw new Error("CONVERSATION_ACTIVE_MISSING");
    return { activeConversationId, conversations };
  }

  async function create(styleId: StyleId): Promise<ConversationRecord> {
    const record = createEmptyConversation({ id: idFactory("conv"), styleId, now: now() });
    await options.store.save(record);
    await options.store.setActive(record.id);
    return structuredClone(record);
  }

  return {
    async initialize(defaultStyleId) {
      await options.store.initialize();
      if ((await options.store.list()).length === 0) await create(defaultStyleId);
      return list();
    },

    list,
    get: requireRecord,
    create,

    async setActive(id) {
      const record = await requireRecord(id);
      await options.store.setActive(id);
      return record;
    },

    rename(id, title) {
      const normalized = title.replace(/\s+/gu, " ").trim();
      if (!normalized || [...normalized].length > 100) {
        return Promise.reject(new Error("CONVERSATION_TITLE_INVALID"));
      }
      return mutate(id, (record) => {
        record.title = normalized;
      });
    },

    async remove(id, fallbackStyleId) {
      await requireRecord(id);
      await options.store.remove(id);
      if ((await options.store.list()).length === 0) await create(fallbackStyleId);
      return list();
    },

    appendPendingUserMessage(input) {
      const text = input.text.trim();
      if (!text) return Promise.reject(new Error("CHAT_MESSAGE_EMPTY"));
      return mutate(input.conversationId, (record) => {
        if (record.messages.some(({ status }) => status === "pending")) {
          throw new Error("CONVERSATION_RUN_IN_PROGRESS");
        }
        if (record.messages.some(({ requestId }) => requestId === input.requestId)) {
          throw new Error("CONVERSATION_REQUEST_DUPLICATE");
        }
        const timestamp = now();
        record.messages.push({
          id: idFactory("msg"),
          conversationId: input.conversationId,
          requestId: input.requestId,
          role: "user",
          content: text,
          createdAt: timestamp,
          tokenEstimate: Math.max(0, Math.ceil(input.tokenEstimate)),
          status: "pending",
        });
        record.lastMessageAt = timestamp;
        if (record.messages.filter(({ role }) => role === "user").length === 1) {
          record.title = generateConversationTitle(text);
        }
      });
    },

    completeRun(conversationId, requestId, generated) {
      return mutate(conversationId, (record) => {
        const pending = record.messages.find((message) =>
          message.requestId === requestId && message.role === "user" && message.status === "pending"
        );
        if (!pending) throw new Error("CONVERSATION_PENDING_REQUEST_NOT_FOUND");
        pending.status = "complete";
        for (const message of generated) {
          const timestamp = now();
          const persisted: ConversationMessage = {
            id: idFactory("msg"),
            conversationId,
            requestId,
            role: message.role === "system" ? "assistant" : message.role,
            content: message.content,
            createdAt: timestamp,
            tokenEstimate: 0,
            status: "complete",
            ...(message.toolCalls ? { toolCalls: message.toolCalls.map((call) => ({ ...call })) } : {}),
            ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
            ...(message.name ? { name: message.name } : {}),
          };
          record.messages.push(persisted);
          record.lastMessageAt = timestamp;
        }
      });
    },

    failRun(conversationId, requestId) {
      return mutate(conversationId, (record) => {
        const pending = record.messages.find((message) =>
          message.requestId === requestId && message.role === "user" && message.status === "pending"
        );
        if (!pending) throw new Error("CONVERSATION_PENDING_REQUEST_NOT_FOUND");
        pending.status = "failed";
      });
    },

    setStyle(id, styleId) {
      return mutate(id, (record) => {
        if (record.styleId === styleId) return;
        record.pendingStyleTransition = { from: record.styleId, to: styleId };
        record.styleId = styleId;
      });
    },

    acknowledgeStyleTransition(id, transition) {
      return mutate(id, (record) => {
        const pending = record.pendingStyleTransition;
        if (pending && transition && pending.from === transition.from && pending.to === transition.to) {
          delete record.pendingStyleTransition;
        }
      });
    },

    setMessagePinned(id, messageId, pinned) {
      return mutate(id, (record) => {
        if (!record.messages.some((message) => message.id === messageId)) {
          throw new Error("CONVERSATION_MESSAGE_NOT_FOUND");
        }
        const ids = new Set(record.pinnedMessageIds);
        if (pinned) ids.add(messageId);
        else ids.delete(messageId);
        record.pinnedMessageIds = [...ids];
      });
    },

    clearMessages(id) {
      return mutate(id, (record) => {
        record.messages = [];
        record.pinnedMessageIds = [];
        record.summary = createEmptyConversation({
          id: record.id,
          styleId: record.styleId,
          now: record.createdAt,
        }).summary;
        delete record.lastMessageAt;
      });
    },

    updateSummary(id, summary) {
      return mutate(id, (record) => {
        record.summary = structuredClone(summary);
      });
    },

    async flush() {
      await Promise.all([...mutationTails.values()]);
      await options.store.flush();
    },
  };
}
