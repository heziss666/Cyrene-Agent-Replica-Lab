import { describe, expect, it, vi } from "vitest";
import { registerConversationIpc } from "../../src/main/app/register-conversation-ipc.js";
import { createEmptyConversation } from "../../src/main/conversations/conversation-types.js";
import { IPC_CHANNELS } from "../../src/shared/ipc-channels.js";

function fakeIpcMain() {
  const handlers = new Map<string, (event: { sender: { send(channel: string, payload: unknown): void } }, payload?: unknown) => Promise<unknown>>();
  return {
    handlers,
    handle: (channel: string, handler: (typeof handlers extends Map<string, infer T> ? T : never)) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  };
}

function service() {
  const record = createEmptyConversation({ id: "conv_1", styleId: "default", now: "2026-07-18T00:00:00.000Z" });
  return {
    list: vi.fn(async () => ({ activeConversationId: "conv_1", conversations: [{ id: "conv_1", title: "New Chat", preview: "", createdAt: record.createdAt, updatedAt: record.updatedAt, styleId: "default" as const, messageCount: 0, hasPendingRun: false }] })),
    get: vi.fn(async () => record),
    create: vi.fn(async () => record),
    setActive: vi.fn(async () => record),
    rename: vi.fn(async () => record),
    remove: vi.fn(async () => ({ activeConversationId: "conv_1", conversations: [] })),
    setMessagePinned: vi.fn(async () => record),
  };
}

describe("registerConversationIpc", () => {
  it("registers list/get/create and returns renderer-safe detail", async () => {
    const ipcMain = fakeIpcMain();
    const conversations = service();
    registerConversationIpc({ ipcMain, service: conversations as never, getDefaultStyle: () => "default" });
    const event = { sender: { send: vi.fn() } };

    await expect(ipcMain.handlers.get(IPC_CHANNELS.conversations.list)!(event)).resolves.toMatchObject({ activeConversationId: "conv_1" });
    await expect(ipcMain.handlers.get(IPC_CHANNELS.conversations.get)!(event, { conversationId: "conv_1" })).resolves.toMatchObject({ id: "conv_1", messages: [] });
    await ipcMain.handlers.get(IPC_CHANNELS.conversations.create)!(event);
    expect(conversations.create).toHaveBeenCalledWith("default");
  });

  it("validates exact mutation payloads and emits changed", async () => {
    const ipcMain = fakeIpcMain();
    const conversations = service();
    registerConversationIpc({ ipcMain, service: conversations as never, getDefaultStyle: () => "default" });
    const send = vi.fn();
    const event = { sender: { send } };
    const rename = ipcMain.handlers.get(IPC_CHANNELS.conversations.rename)!;

    await rename(event, { conversationId: "conv_1", title: "Renamed" });
    expect(conversations.rename).toHaveBeenCalledWith("conv_1", "Renamed");
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.conversations.changed, expect.any(Object));
    await expect(rename(event, { conversationId: "conv_1", title: "x", extra: true })).rejects.toThrow("Invalid conversations IPC payload");
  });

  it("pins messages and disposes every invoke handler", async () => {
    const ipcMain = fakeIpcMain();
    const conversations = service();
    const runtime = registerConversationIpc({ ipcMain, service: conversations as never, getDefaultStyle: () => "default" });
    const event = { sender: { send: vi.fn() } };

    await ipcMain.handlers.get(IPC_CHANNELS.conversations.setMessagePinned)!(event, { conversationId: "conv_1", messageId: "msg_1", pinned: true });
    expect(conversations.setMessagePinned).toHaveBeenCalledWith("conv_1", "msg_1", true);
    runtime.dispose();
    expect(ipcMain.handlers.size).toBe(0);
  });
});
