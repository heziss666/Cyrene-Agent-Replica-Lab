import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createEmptyConversation,
  type ConversationRecord,
} from "../../src/main/conversations/conversation-types.js";
import { createConversationStore } from "../../src/main/conversations/conversation-store.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cyrene-conversations-"));
  roots.push(root);
  return root;
}

function conversation(id: string, title = id): ConversationRecord {
  return {
    ...createEmptyConversation({
      id,
      styleId: "default",
      now: "2026-07-18T00:00:00.000Z",
    }),
    title,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("conversation store", () => {
  it("round-trips messages including tool protocol fields", async () => {
    const rootDir = await temporaryRoot();
    const store = createConversationStore({ rootDir });
    await store.initialize();
    const record = conversation("conv_a", "Tools");
    record.messages.push({
      id: "msg_1",
      conversationId: "conv_a",
      requestId: "req_1",
      role: "assistant",
      content: "",
      createdAt: record.createdAt,
      tokenEstimate: 4,
      status: "complete",
      toolCalls: [{ id: "call_1", name: "get_time", arguments: "{}" }],
    }, {
      id: "msg_2",
      conversationId: "conv_a",
      requestId: "req_1",
      role: "tool",
      name: "get_time",
      content: "12:00",
      createdAt: record.createdAt,
      tokenEstimate: 4,
      status: "complete",
      toolCallId: "call_1",
    });

    await store.save(record);

    expect(await store.load("conv_a")).toEqual(record);
    expect((await store.list())[0]).toMatchObject({ id: "conv_a", title: "Tools", messageCount: 2 });
  });

  it("rebuilds a missing index from valid session files", async () => {
    const rootDir = await temporaryRoot();
    const first = createConversationStore({ rootDir });
    await first.initialize();
    await first.save(conversation("conv_a", "A"));
    await unlink(join(rootDir, "index.json"));

    const second = createConversationStore({ rootDir });
    const result = await second.initialize();

    expect(result.rebuiltIndex).toBe(true);
    expect((await second.list()).map(({ id }) => id)).toEqual(["conv_a"]);
  });

  it("quarantines an invalid session without hiding valid sessions", async () => {
    const rootDir = await temporaryRoot();
    const first = createConversationStore({ rootDir });
    await first.initialize();
    await first.save(conversation("conv_a", "A"));
    await writeFile(join(rootDir, "sessions", "broken.json"), "{invalid", "utf8");
    await unlink(join(rootDir, "index.json"));

    const second = createConversationStore({ rootDir });
    const result = await second.initialize();

    expect(result.quarantinedCount).toBe(1);
    expect((await second.list()).map(({ id }) => id)).toEqual(["conv_a"]);
    expect(await readFile(join(rootDir, "index.json"), "utf8")).toContain("conv_a");
  });

  it("deletes only the selected conversation and repairs the active id", async () => {
    const rootDir = await temporaryRoot();
    const store = createConversationStore({ rootDir });
    await store.initialize();
    await store.save(conversation("conv_a"));
    await store.save(conversation("conv_b"));
    await store.setActive("conv_a");

    await store.remove("conv_a");

    expect(await store.load("conv_a")).toBeUndefined();
    expect(await store.load("conv_b")).toBeDefined();
    expect(await store.getActiveId()).toBe("conv_b");
  });

  it("flush waits for saves queued before it", async () => {
    const rootDir = await temporaryRoot();
    const store = createConversationStore({ rootDir });
    await store.initialize();
    const save = store.save(conversation("conv_a"));

    await store.flush();

    await expect(save).resolves.toBeUndefined();
    expect(await store.load("conv_a")).toBeDefined();
  });
});
