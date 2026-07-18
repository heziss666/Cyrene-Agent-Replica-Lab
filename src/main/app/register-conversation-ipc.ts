import type {
  ConversationChangedPayload,
  ConversationDetail,
} from "../../shared/conversation-types.js";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import type { StyleId } from "../../shared/persona-types.js";
import type { ConversationService } from "../conversations/conversation-service.js";
import type { ConversationRecord } from "../conversations/conversation-types.js";

type Sender = { send(channel: string, payload: ConversationChangedPayload): void };
type Handler = (event: { sender: Sender }, payload?: unknown) => Promise<unknown>;

export interface ConversationIpcMainLike {
  handle(channel: string, handler: Handler): void;
  removeHandler(channel: string): void;
}

export interface ConversationIpcRuntime {
  dispose(): void;
}

const INVOKE_CHANNELS = [
  IPC_CHANNELS.conversations.list,
  IPC_CHANNELS.conversations.create,
  IPC_CHANNELS.conversations.get,
  IPC_CHANNELS.conversations.setActive,
  IPC_CHANNELS.conversations.rename,
  IPC_CHANNELS.conversations.remove,
  IPC_CHANNELS.conversations.setMessagePinned,
] as const;
const ID = /^[A-Za-z0-9_.-]{1,200}$/u;
const activeRegistrations = new WeakMap<ConversationIpcMainLike, object>();

function exactObject(payload: unknown, keys: string[]): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Invalid conversations IPC payload");
  }
  const prototype = Object.getPrototypeOf(payload);
  const actual = Reflect.ownKeys(payload);
  if ((prototype !== Object.prototype && prototype !== null)
    || actual.length !== keys.length || keys.some((key) => !actual.includes(key))) {
    throw new Error("Invalid conversations IPC payload");
  }
  return payload as Record<string, unknown>;
}

function parseId(payload: unknown): string {
  const value = exactObject(payload, ["conversationId"]).conversationId;
  if (typeof value !== "string" || !ID.test(value)) throw new Error("Invalid conversations IPC payload");
  return value;
}

function toDetail(record: ConversationRecord): ConversationDetail {
  const pinned = new Set(record.pinnedMessageIds);
  const visible = record.messages.filter(({ role }) => role === "user" || role === "assistant");
  const preview = [...visible].reverse().find(({ content }) => content.trim())?.content.trim().slice(0, 120) ?? "";
  return {
    id: record.id,
    title: record.title,
    preview,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastMessageAt: record.lastMessageAt,
    styleId: record.styleId,
    messageCount: record.messages.length,
    hasPendingRun: record.messages.some(({ status }) => status === "pending"),
    messages: visible.map(({ id, role, content, createdAt, status }) => ({
      id,
      role: role as "user" | "assistant",
      content,
      createdAt,
      status,
      isPinned: pinned.has(id),
    })),
    summary: {
      overview: record.summary.overview,
      decisions: [...record.summary.decisions],
      constraints: [...record.summary.constraints],
      userRequests: [...record.summary.userRequests],
      openTasks: [...record.summary.openTasks],
      importantToolResults: [...record.summary.importantToolResults],
      entities: [...record.summary.entities],
      sourceMessageCount: record.summary.sourceMessageCount,
      updatedAt: record.summary.updatedAt,
    },
  };
}

export function registerConversationIpc(options: {
  ipcMain: ConversationIpcMainLike;
  service: Pick<ConversationService, "list" | "get" | "create" | "setActive" | "rename" | "remove" | "setMessagePinned">;
  getDefaultStyle(): StyleId;
}): ConversationIpcRuntime {
  const token = {};
  activeRegistrations.set(options.ipcMain, token);
  for (const channel of INVOKE_CHANNELS) options.ipcMain.removeHandler(channel);

  async function notify(sender: Sender): Promise<void> {
    const snapshot = await options.service.list();
    sender.send(IPC_CHANNELS.conversations.changed, snapshot);
  }

  options.ipcMain.handle(IPC_CHANNELS.conversations.list, async () => options.service.list());
  options.ipcMain.handle(IPC_CHANNELS.conversations.get, async (_event, payload) => toDetail(await options.service.get(parseId(payload))));
  options.ipcMain.handle(IPC_CHANNELS.conversations.create, async (event) => {
    const conversation = toDetail(await options.service.create(options.getDefaultStyle()));
    await notify(event.sender);
    return { conversation };
  });
  options.ipcMain.handle(IPC_CHANNELS.conversations.setActive, async (event, payload) => {
    const result = toDetail(await options.service.setActive(parseId(payload)));
    await notify(event.sender);
    return result;
  });
  options.ipcMain.handle(IPC_CHANNELS.conversations.rename, async (event, payload) => {
    const object = exactObject(payload, ["conversationId", "title"]);
    if (typeof object.conversationId !== "string" || !ID.test(object.conversationId)
      || typeof object.title !== "string") throw new Error("Invalid conversations IPC payload");
    const result = toDetail(await options.service.rename(object.conversationId, object.title));
    await notify(event.sender);
    return result;
  });
  options.ipcMain.handle(IPC_CHANNELS.conversations.remove, async (event, payload) => {
    const result = await options.service.remove(parseId(payload), options.getDefaultStyle());
    await notify(event.sender);
    return result;
  });
  options.ipcMain.handle(IPC_CHANNELS.conversations.setMessagePinned, async (event, payload) => {
    const object = exactObject(payload, ["conversationId", "messageId", "pinned"]);
    if (typeof object.conversationId !== "string" || !ID.test(object.conversationId)
      || typeof object.messageId !== "string" || !ID.test(object.messageId)
      || typeof object.pinned !== "boolean") throw new Error("Invalid conversations IPC payload");
    const result = toDetail(await options.service.setMessagePinned(object.conversationId, object.messageId, object.pinned));
    await notify(event.sender);
    return result;
  });

  return {
    dispose() {
      if (activeRegistrations.get(options.ipcMain) !== token) return;
      activeRegistrations.delete(options.ipcMain);
      for (const channel of INVOKE_CHANNELS) options.ipcMain.removeHandler(channel);
    },
  };
}
