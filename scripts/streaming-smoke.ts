import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentRunManager } from "../src/main/runs/agent-run-manager.js";
import { createAgentRunStore } from "../src/main/runs/agent-run-store.js";

const rootDir = await mkdtemp(join(tmpdir(), "cyrene-streaming-smoke-"));
try {
  const store = createAgentRunStore({ rootDir });
  await store.initialize();
  const manager = createAgentRunManager({ store, maxConcurrent: 2, idFactory: () => "run_streaming_smoke" });
  const accepted = await manager.submit({
    source: "chat",
    conversationId: "smoke",
    requestId: "request_smoke",
    execute: async ({ emit }) => {
      emit("text_delta", { delta: "Hello" });
      emit("text_delta", { delta: " world" });
    },
  });
  const record = await manager.wait(accepted.runId);
  if (record?.status !== "succeeded" || record.events.filter(({ type }) => type === "text_delta").length !== 2) {
    throw new Error("STREAMING_SMOKE_FAILED");
  }
  process.stdout.write(`Streaming smoke passed: ${record.runId}, ${record.events.length} trace events\n`);
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
