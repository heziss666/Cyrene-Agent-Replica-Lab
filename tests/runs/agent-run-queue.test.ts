import { describe, expect, it } from "vitest";
import { createAgentRunQueue } from "../../src/main/runs/agent-run-queue.js";

function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

describe("agent run queue", () => {
  it("limits global and per-conversation runs without head-of-line blocking", async () => {
    const queue = createAgentRunQueue({ maxConcurrent: 2 });
    const a1 = deferred(); const b1 = deferred(); const c1 = deferred(); const a2 = deferred();
    const started: string[] = [];
    const add = (id: string, conversationId: string, gate: ReturnType<typeof deferred>) => queue.enqueue({ id, conversationId, run: async () => { started.push(id); await gate.promise; } });
    add("a1", "a", a1); add("b1", "b", b1); add("a2", "a", a2); add("c1", "c", c1);
    await Promise.resolve(); expect(started).toEqual(["a1", "b1"]); expect(queue.activeCount()).toBe(2);
    b1.resolve(); await queue.flushTick(); expect(started).toEqual(["a1", "b1", "c1"]);
    c1.resolve(); a1.resolve(); await queue.flushTick(); expect(started).toContain("a2");
    a2.resolve(); await queue.flush(); expect(queue.pendingCount()).toBe(0);
  });

  it("cancels queued work and rejects new work during shutdown", async () => {
    const queue = createAgentRunQueue({ maxConcurrent: 1 }); const gate = deferred(); let secondRan = false;
    queue.enqueue({ id: "one", conversationId: "a", run: () => gate.promise });
    queue.enqueue({ id: "two", conversationId: "b", run: async () => { secondRan = true; } });
    expect(queue.cancel("two")).toBe(true); expect(secondRan).toBe(false);
    queue.beginShutdown();
    expect(() => queue.enqueue({ id: "three", run: async () => undefined })).toThrow("AGENT_RUN_QUEUE_SHUTTING_DOWN");
    gate.resolve(); await queue.flush();
  });
});
