import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentRunStore } from "../../src/main/runs/agent-run-store.js";
import type { AgentRunRecord } from "../../src/main/runs/agent-run-types.js";

function sample(id = "run_1"): AgentRunRecord {
  return { schemaVersion: 1, runId: id, source: "chat", conversationId: "c", status: "queued", queuedAt: "2026-07-18T00:00:00.000Z",
    roundsUsed: 0, modelCallCount: 0, toolCallCount: 0,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: "estimated" }, events: [] };
}

describe("agent run store", () => {
  it("persists, reloads, removes, and clears records", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "cyrene-runs-"));
    const store = createAgentRunStore({ rootDir });
    await store.initialize(); await store.save(sample());
    expect((await store.load("run_1"))?.status).toBe("queued");
    expect(await store.list()).toHaveLength(1);
    await store.remove("run_1"); expect(await store.list()).toEqual([]);
    await store.save(sample("run_2")); await store.clear(); expect(await store.list()).toEqual([]);
  });

  it("rebuilds a missing index and quarantines corrupt records", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "cyrene-runs-"));
    const first = createAgentRunStore({ rootDir }); await first.initialize(); await first.save(sample()); await first.flush();
    await writeFile(join(rootDir, "records", "bad.json"), "not json", "utf8");
    await writeFile(join(rootDir, "index.json"), "not json", "utf8");
    const second = createAgentRunStore({ rootDir });
    const initialized = await second.initialize();
    expect(initialized.rebuiltIndex).toBe(true); expect(initialized.quarantinedCount).toBe(1);
    expect(await second.list()).toHaveLength(1);
    expect(await readFile(join(rootDir, "index.json"), "utf8")).toContain("run_1");
  });
});
