import { describe, expect, it } from "vitest";
import { applyRunRetention } from "../../src/main/runs/run-retention.js";
import type { AgentRunRecord } from "../../src/main/runs/agent-run-types.js";

function record(index: number, queuedAt: string): AgentRunRecord {
  return { schemaVersion: 1, runId: `run_${index}`, source: "chat", conversationId: "c", status: "succeeded", queuedAt,
    roundsUsed: 0, modelCallCount: 0, toolCallCount: 0,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: "estimated" }, events: [] };
}

describe("applyRunRetention", () => {
  it("removes expired records then keeps the newest bounded set", () => {
    const now = new Date("2026-07-18T00:00:00.000Z");
    const records = [record(0, "2026-06-01T00:00:00.000Z"),
      ...Array.from({ length: 1002 }, (_, i) => record(i + 1, new Date(now.getTime() - i * 1000).toISOString()))];
    const result = applyRunRetention(records, { now, maxAgeMs: 30 * 86_400_000, maxRecords: 1000 });
    expect(result.kept).toHaveLength(1000);
    expect(result.removed.map(({ runId }) => runId)).toContain("run_0");
    expect(result.kept[0].runId).toBe("run_1");
  });
});
