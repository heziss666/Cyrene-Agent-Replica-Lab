import { mkdtemp } from "node:fs/promises"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentRunStore } from "../../src/main/runs/agent-run-store.js";
import { createAgentRunManager } from "../../src/main/runs/agent-run-manager.js";

describe("agent run manager", () => {
  it("persists ordered events, usage, and success", async () => {
    const store = createAgentRunStore({ rootDir: await mkdtemp(join(tmpdir(), "run-manager-")) }); await store.initialize();
    const manager = createAgentRunManager({ store, maxConcurrent: 2, idFactory: () => "run_test" });
    const accepted = await manager.submit({ source: "chat", conversationId: "c", requestId: "q", execute: async ({ emit, recordUsage }) => {
      emit("model_started"); recordUsage({ inputTokens: 4, outputTokens: 2, source: "provider" }); emit("model_finished");
    }});
    await manager.flush(); const record = await manager.get(accepted.runId);
    expect(record?.status).toBe("succeeded"); expect(record?.usage.totalTokens).toBe(6);
    expect(record?.events.map(({ sequence }) => sequence).every((n, i) => n === i + 1)).toBe(true);
  });

  it("cancels an active run through AbortSignal", async () => {
    const store = createAgentRunStore({ rootDir: await mkdtemp(join(tmpdir(), "run-manager-")) }); await store.initialize();
    const manager = createAgentRunManager({ store, maxConcurrent: 1, idFactory: () => "run_cancel" });
    const accepted = await manager.submit({ source: "chat", conversationId: "c", execute: ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })) });
    await new Promise((resolve) => setTimeout(resolve, 0)); expect(await manager.cancel(accepted.runId)).toBe(true);
    await manager.flush(); expect((await manager.get(accepted.runId))?.status).toBe("cancelled");
  });

  it("waits for a submitted run and returns its terminal record", async () => {
    const store = createAgentRunStore({ rootDir: await mkdtemp(join(tmpdir(), "run-manager-")) }); await store.initialize();
    const manager = createAgentRunManager({ store, maxConcurrent: 1, idFactory: () => "run_wait" });
    const accepted = await manager.submit({ source: "scheduler", taskId: "task_1", execute: async () => undefined });

    await expect(manager.wait(accepted.runId)).resolves.toMatchObject({
      runId: "run_wait",
      status: "succeeded",
    });
  });
});
