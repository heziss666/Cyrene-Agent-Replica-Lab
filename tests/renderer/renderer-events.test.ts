import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../src/main/agent/agent-events.js";
import {
  filterSafeMemoryWriteKeys,
  getSafeMemoryWriteFailureMessage,
} from "../../src/main/agent/agent-events.js";
import {
  formatRendererErrorMessage,
  formatRendererEvent,
  formatRendererEventPayload,
} from "../../src/renderer/chat/renderer-events.js";

describe("formatRendererEvent", () => {
  it("formats agent events for the chat event log", () => {
    expect(
      formatRendererEvent({
        type: "model_call_started",
        round: 1,
        messageCount: 2,
        toolCount: 3,
      }),
    ).toBe("Model round 1 started: 2 messages, 3 tools");

    expect(
      formatRendererEvent({
        type: "tool_call_started",
        round: 1,
        toolCallId: "call_1",
        toolName: "calculator",
        args: { expression: "2 + 2" },
      }),
    ).toBe('Tool calculator started with {"expression":"2 + 2"}');

    expect(
      formatRendererEvent({
        type: "run_error",
        message: "Model request failed",
      }),
    ).toBe("Run failed: Model request failed");
  });

  it("formats memory lifecycle events without exposing memory contents", () => {
    const untrustedWrites = [
      "L1.currentProject",
      "L1.currentProject",
      "L2",
      "candidate secret",
      "L1.currentProject=API_KEY=secret",
    ];
    const safeWrites = filterSafeMemoryWriteKeys(untrustedWrites);
    const safeFailureMessage = getSafeMemoryWriteFailureMessage("judge");
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
        writes: safeWrites,
      },
      {
        type: "memory_write_failed",
        stage: "judge",
        message: safeFailureMessage,
      },
    ];

    expect(events.map(formatRendererEvent)).toEqual([
      "Memory recall started",
      "Memory recall finished: mode=vector, L0=yes, L1=yes, L2=2",
      "Memory write scheduled: 1 pending",
      "Memory judge started",
      "Memory judge finished: 2 candidates",
      "Memory write finished: 1 written, 1 skipped (keys: L1.currentProject, L2)",
      "Memory write failed during judge: Memory judge unavailable",
    ]);

    const payload = JSON.stringify(events);
    const output = events.map(formatRendererEvent).join("\n");
    expect(payload).not.toContain("candidate secret");
    expect(payload).not.toContain("API_KEY=secret");
    expect(output).not.toContain("candidate secret");
    expect(output).not.toContain("API_KEY=secret");
    expect(output).not.toContain("evidence");
    expect(output.length).toBeLessThan(400);
  });
});

describe("formatRendererEventPayload", () => {
  it("prefixes formatted event text with the run id", () => {
    expect(
      formatRendererEventPayload({
        runId: "run_12",
        event: {
          type: "model_call_started",
          round: 1,
          messageCount: 2,
          toolCount: 3,
        },
      }),
    ).toBe("[run_12] Model round 1 started: 2 messages, 3 tools");
  });
});

describe("formatRendererErrorMessage", () => {
  it("formats unknown renderer errors as visible agent messages", () => {
    expect(formatRendererErrorMessage(new Error("Model request failed"))).toBe(
      "请求失败：Model request failed",
    );

    expect(formatRendererErrorMessage("CYRENE_MODEL_API_KEY is required")).toBe(
      "请求失败：CYRENE_MODEL_API_KEY is required",
    );
  });
});
