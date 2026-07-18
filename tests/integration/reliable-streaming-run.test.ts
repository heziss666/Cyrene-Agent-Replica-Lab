import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentRunManager } from "../../src/main/runs/agent-run-manager.js";
import { createAgentRunStore } from "../../src/main/runs/agent-run-store.js";

describe("reliable streaming run integration", () => {
  it("persists deltas and serializes the same conversation", async () => {
    const store = createAgentRunStore({ rootDir: await mkdtemp(join(tmpdir(), "streaming-run-")) });
    await store.initialize();
    let id = 0;
    const manager = createAgentRunManager({ store, maxConcurrent: 2, idFactory: () => `run_${++id}` });
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = await manager.submit({ source: "chat", conversationId: "conv_a", execute: async ({ emit }) => {
      order.push("first-start"); emit("text_delta", { delta: "hello" }); await gate; order.push("first-end");
    } });
    const second = await manager.submit({ source: "chat", conversationId: "conv_a", execute: async () => { order.push("second-start"); } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["first-start"]);
    release();
    await Promise.all([manager.wait(first.runId), manager.wait(second.runId)]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
    expect((await manager.get(first.runId))?.events.some(({ type }) => type === "text_delta")).toBe(true);
  });
});
