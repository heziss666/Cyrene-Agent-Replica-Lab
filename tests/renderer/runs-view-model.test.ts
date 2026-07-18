import { describe, expect, it } from "vitest";
import { createRunsViewModel } from "../../src/renderer/chat/runs-view-model.js";
import type { AgentRunSummary } from "../../src/main/runs/agent-run-types.js";

const run = (runId: string, source: "chat" | "scheduler", status: AgentRunSummary["status"]): AgentRunSummary => ({
  schemaVersion: 1, runId, source, status, queuedAt: "2026-07-18T00:00:00.000Z",
  roundsUsed: 1, modelCallCount: 1, toolCallCount: 0,
  usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5, source: "provider" },
});

describe("runs view model", () => {
  it("filters by source, status, and text", () => {
    const model = createRunsViewModel();
    model.setRuns([run("run_chat", "chat", "failed"), run("run_task", "scheduler", "succeeded")]);
    model.setFilters({ source: "chat", status: "failed", query: "chat" });
    expect(model.snapshot().visible.map(({ runId }) => runId)).toEqual(["run_chat"]);
  });

  it("sorts trace events chronologically", () => {
    const model = createRunsViewModel();
    model.setSelected({ ...run("run_chat", "chat", "failed"), events: [
      { sequence: 2, timestamp: "2026-07-18T00:00:02.000Z", type: "b" },
      { sequence: 1, timestamp: "2026-07-18T00:00:01.000Z", type: "a" },
    ] });
    expect(model.snapshot().selected?.events.map(({ sequence }) => sequence)).toEqual([1, 2]);
  });
});
