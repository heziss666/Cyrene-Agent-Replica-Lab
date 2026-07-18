import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConversationService } from "../../src/main/conversations/conversation-service.js";
import { createConversationStore } from "../../src/main/conversations/conversation-store.js";

const roots: string[] = [];

async function setup() {
  const rootDir = await mkdtemp(join(tmpdir(), "cyrene-service-"));
  roots.push(rootDir);
  let id = 0;
  let tick = 0;
  const service = createConversationService({
    store: createConversationStore({ rootDir }),
    idFactory: (prefix) => `${prefix}_${++id}`,
    now: () => new Date(Date.UTC(2026, 6, 18, 0, 0, tick++)).toISOString(),
  });
  await service.initialize("default");
  return service;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("conversation service", () => {
  it("creates a default conversation on first initialization", async () => {
    const service = await setup();
    const list = await service.list();

    expect(list.conversations).toHaveLength(1);
    expect(list.activeConversationId).toBe(list.conversations[0].id);
    expect((await service.get(list.activeConversationId)).styleId).toBe("default");
  });

  it("keeps persona and pending transitions isolated", async () => {
    const service = await setup();
    const a = await service.create("default");
    const b = await service.create("default");

    await service.setStyle(a.id, "healing");

    expect((await service.get(a.id)).pendingStyleTransition).toEqual({ from: "default", to: "healing" });
    expect((await service.get(b.id)).styleId).toBe("default");
    await service.acknowledgeStyleTransition(a.id, { from: "default", to: "healing" });
    expect((await service.get(a.id)).pendingStyleTransition).toBeUndefined();
  });

  it("persists a pending user request before completing generated messages", async () => {
    const service = await setup();
    const conversationId = (await service.list()).activeConversationId;

    await service.appendPendingUserMessage({
      conversationId,
      requestId: "req_1",
      text: "What time is it?",
      tokenEstimate: 5,
    });
    expect((await service.get(conversationId)).messages[0]).toMatchObject({
      requestId: "req_1",
      status: "pending",
      role: "user",
    });

    await service.completeRun(conversationId, "req_1", [{
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call_1", name: "get_time", arguments: "{}" }],
    }, {
      role: "tool",
      content: "12:00",
      name: "get_time",
      toolCallId: "call_1",
    }, {
      role: "assistant",
      content: "It is 12:00.",
    }]);

    const record = await service.get(conversationId);
    expect(record.messages.map(({ role, status }) => [role, status])).toEqual([
      ["user", "complete"],
      ["assistant", "complete"],
      ["tool", "complete"],
      ["assistant", "complete"],
    ]);
    expect(record.title).toBe("What time is it?");
  });

  it("checkpoints a streamed reply under one stable message id", async () => {
    const service = await setup();
    const conversationId = (await service.list()).activeConversationId;
    await service.appendPendingUserMessage({
      conversationId,
      requestId: "req_stream",
      text: "Explain streaming",
      tokenEstimate: 3,
    });

    const started = await service.startAssistantStream(conversationId, "req_stream");
    const assistant = started.messages[1];
    expect(started.messages[0].status).toBe("complete");
    expect(assistant).toMatchObject({ role: "assistant", status: "streaming", content: "" });

    const checkpoint = await service.checkpointAssistantStream(
      conversationId,
      "req_stream",
      "partial reply",
    );
    expect(checkpoint.messages[1]).toMatchObject({
      id: assistant.id,
      status: "streaming",
      content: "partial reply",
    });

    const cancelled = await service.finishAssistantStream(
      conversationId,
      "req_stream",
      "cancelled",
    );
    expect(cancelled.messages[1]).toMatchObject({
      id: assistant.id,
      status: "cancelled",
      content: "partial reply",
    });
  });

  it("replaces a streaming placeholder with the completed agent transcript", async () => {
    const service = await setup();
    const conversationId = (await service.list()).activeConversationId;
    await service.appendPendingUserMessage({
      conversationId,
      requestId: "req_stream",
      text: "Use a tool",
      tokenEstimate: 3,
    });
    await service.startAssistantStream(conversationId, "req_stream");
    await service.checkpointAssistantStream(conversationId, "req_stream", "draft");

    await service.completeRun(conversationId, "req_stream", [{
      role: "assistant",
      content: "final reply",
    }]);

    const record = await service.get(conversationId);
    expect(record.messages.map(({ role, status, content }) => [role, status, content])).toEqual([
      ["user", "complete", "Use a tool"],
      ["assistant", "complete", "final reply"],
    ]);
  });

  it("marks interrupted pending and streaming messages failed on restart", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "cyrene-service-restart-"));
    roots.push(rootDir);
    let id = 0;
    const first = createConversationService({
      store: createConversationStore({ rootDir }),
      idFactory: (prefix) => `${prefix}_${++id}`,
    });
    await first.initialize("default");
    const conversationId = (await first.list()).activeConversationId;
    await first.appendPendingUserMessage({
      conversationId,
      requestId: "req_interrupted",
      text: "long answer",
      tokenEstimate: 2,
    });
    await first.startAssistantStream(conversationId, "req_interrupted");
    await first.checkpointAssistantStream(conversationId, "req_interrupted", "half answer");
    await first.flush();

    const restarted = createConversationService({ store: createConversationStore({ rootDir }) });
    await restarted.initialize("default");

    expect((await restarted.get(conversationId)).messages.map(({ status }) => status)).toEqual([
      "complete",
      "failed",
    ]);
  });

  it("marks failed requests and rejects concurrent requests in one conversation", async () => {
    const service = await setup();
    const conversationId = (await service.list()).activeConversationId;
    await service.appendPendingUserMessage({ conversationId, requestId: "req_1", text: "hello", tokenEstimate: 2 });

    await expect(service.appendPendingUserMessage({
      conversationId,
      requestId: "req_2",
      text: "again",
      tokenEstimate: 2,
    })).rejects.toThrow("CONVERSATION_RUN_IN_PROGRESS");

    await service.failRun(conversationId, "req_1");
    expect((await service.get(conversationId)).messages[0].status).toBe("failed");
  });

  it("validates pinned messages", async () => {
    const service = await setup();
    const conversationId = (await service.list()).activeConversationId;
    await service.appendPendingUserMessage({ conversationId, requestId: "req_1", text: "remember this", tokenEstimate: 3 });
    await service.failRun(conversationId, "req_1");
    const messageId = (await service.get(conversationId)).messages[0].id;

    await service.setMessagePinned(conversationId, messageId, true);
    expect((await service.get(conversationId)).pinnedMessageIds).toEqual([messageId]);
    await expect(service.setMessagePinned(conversationId, "missing", true)).rejects.toThrow(
      "CONVERSATION_MESSAGE_NOT_FOUND",
    );
  });

  it("creates a replacement after deleting the final conversation", async () => {
    const service = await setup();
    const original = (await service.list()).activeConversationId;

    const result = await service.remove(original, "focused");

    expect(result.activeConversationId).not.toBe(original);
    expect(result.conversations).toHaveLength(1);
    expect((await service.get(result.activeConversationId)).styleId).toBe("focused");
  });

  it("clears messages without resetting the conversation persona", async () => {
    const service = await setup();
    const conversationId = (await service.list()).activeConversationId;
    await service.setStyle(conversationId, "lively");
    await service.appendPendingUserMessage({ conversationId, requestId: "req_1", text: "hello", tokenEstimate: 2 });
    await service.failRun(conversationId, "req_1");

    const cleared = await service.clearMessages(conversationId);

    expect(cleared.messages).toEqual([]);
    expect(cleared.styleId).toBe("lively");
  });
});
