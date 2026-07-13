import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../src/main/agent/agent-events.js";
import {
  createAgentTraceCollector,
  formatAgentEventForTerminal,
} from "../../src/main/agent/agent-events.js";

describe("formatAgentEventForTerminal", () => {
  it("formats lifecycle, model, tool, and final reply events for terminal output", () => {
    expect(
      formatAgentEventForTerminal({
        type: "run_started",
        inputMessageCount: 2,
        maxRounds: 5,
      }),
    ).toBe("[run] started messages=2 maxRounds=5");

    expect(
      formatAgentEventForTerminal({
        type: "model_call_started",
        round: 1,
        messageCount: 2,
        toolCount: 3,
      }),
    ).toBe("[model] round 1 -> messages=2 tools=3");

    expect(
      formatAgentEventForTerminal({
        type: "model_call_finished",
        round: 1,
        text: "",
        toolCallCount: 1,
      }),
    ).toBe("[model] round 1 <- toolCalls=1");

    expect(
      formatAgentEventForTerminal({
        type: "tool_call_started",
        round: 1,
        toolCallId: "call_1",
        toolName: "calculator",
        args: { expression: "2 + 2" },
      }),
    ).toBe('[tool] round 1 -> calculator args={"expression":"2 + 2"}');

    expect(
      formatAgentEventForTerminal({
        type: "tool_call_finished",
        round: 1,
        toolCallId: "call_1",
        toolName: "calculator",
        output: "4",
      }),
    ).toBe("[tool] round 1 <- calculator result=4");

    expect(
      formatAgentEventForTerminal({
        type: "final_reply",
        round: 2,
        text: "The answer is 4.",
      }),
    ).toBe("[agent] round 2 final=The answer is 4.");

    expect(
      formatAgentEventForTerminal({
        type: "run_finished",
        roundsUsed: 2,
        toolResultCount: 1,
      }),
    ).toBe("[run] finished rounds=2 toolResults=1");
  });

  it("formats long event text as a single-line preview", () => {
    expect(
      formatAgentEventForTerminal({
        type: "run_error",
        message: `first line\n${"x".repeat(200)}`,
      }),
    ).toBe(`[run] error first line ${"x".repeat(144)}...`);
  });

  it("formats memory lifecycle events without exposing memory contents", () => {
    const events: AgentEvent[] = [
      { type: "memory_recall_started" },
      {
        type: "memory_recall_finished",
        l0Included: true,
        l1Included: true,
        l2Count: 2,
        mode: "vector",
      },
      { type: "memory_write_scheduled", pendingCount: 1 },
      { type: "memory_judge_started" },
      { type: "memory_judge_finished", candidateCount: 2 },
      {
        type: "memory_write_finished",
        writtenCount: 1,
        skippedCount: 1,
        writes: ["L1.currentProject", "API_KEY=secret"],
      },
      {
        type: "memory_write_failed",
        stage: "judge",
        message: "model unavailable; evidence=private note",
      },
    ];

    expect(events.map(formatAgentEventForTerminal)).toEqual([
      "[memory] recall started",
      "[memory] recall finished mode=vector l0=true l1=true l2=2",
      "[memory] write scheduled pending=1",
      "[memory] judge started",
      "[memory] judge finished candidates=2",
      "[memory] write finished written=1 skipped=1",
      "[memory] write failed stage=judge",
    ]);

    const output = events.map(formatAgentEventForTerminal).join("\n");
    expect(output).not.toContain("API_KEY=secret");
    expect(output).not.toContain("private note");
  });
});

describe("createAgentTraceCollector", () => {
  it("collects events through an onEvent callback", () => {
    const trace = createAgentTraceCollector();

    trace.onEvent({
      type: "run_started",
      inputMessageCount: 1,
      maxRounds: 5,
    });
    trace.onEvent({
      type: "run_finished",
      roundsUsed: 1,
      toolResultCount: 0,
    });

    expect(trace.events).toEqual([
      {
        type: "run_started",
        inputMessageCount: 1,
        maxRounds: 5,
      },
      {
        type: "run_finished",
        roundsUsed: 1,
        toolResultCount: 0,
      },
    ]);
  });
});
