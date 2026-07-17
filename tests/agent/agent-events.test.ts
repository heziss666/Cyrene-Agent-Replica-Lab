import { describe, expect, it } from "vitest";
import type {
  AgentEvent,
  MemoryWriteFailureMessage,
  SafeMemoryWriteKey,
} from "../../src/main/agent/agent-events.js";
import {
  createAgentTraceCollector,
  createMemoryConflictDetectedEvent,
  createMemoryGovernanceChangedEvent,
  createMemoryIntelligenceFinishedEvent,
  createMemoryResolverFailedEvent,
  createMemoryResolverFinishedEvent,
  createMemoryResolverStartedEvent,
  createMemoryWriteFailedEvent,
  createMemoryWriteFinishedEvent,
  filterSafeMemoryWriteKeys,
  formatAgentEventForTerminal,
  getSafeMemoryWriteFailureMessage,
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

  it("formats MCP lifecycle events without exposing config secrets", () => {
    const events: AgentEvent[] = [
      { type: "mcp_server_connecting", serverId: "demo" },
      { type: "mcp_server_connected", serverId: "demo", toolCount: 2 },
      { type: "mcp_tools_changed", serverId: "demo", toolCount: 3 },
      { type: "mcp_tool_approval_requested", serverId: "demo", toolId: "demo__write" },
      { type: "mcp_tool_approval_resolved", serverId: "demo", toolId: "demo__write", allowed: false },
      { type: "mcp_server_disconnected", serverId: "demo" },
      { type: "mcp_server_failed", serverId: "demo", errorCode: "MCP_CONNECT_FAILED" },
    ];

    expect(events.map(formatAgentEventForTerminal)).toEqual([
      "[mcp] connecting server=demo",
      "[mcp] connected server=demo tools=2",
      "[mcp] tools changed server=demo tools=3",
      "[mcp] approval requested server=demo tool=demo__write",
      "[mcp] approval resolved server=demo tool=demo__write allowed=false",
      "[mcp] disconnected server=demo",
      "[mcp] failed server=demo code=MCP_CONNECT_FAILED",
    ]);
    expect(JSON.stringify(events)).not.toMatch(/token|header|env|args/i);
  });

  it("filters and deduplicates memory write keys and maps failure stages safely", () => {
    expect(
      filterSafeMemoryWriteKeys([
        "L0.preferredName",
        "L0.occupation",
        "L0.longTermInterests",
        "L0.language",
        "L0.permanentNotes",
        "L1.currentProject",
        "L1.recentGoals",
        "L1.recentPreferences",
        "L2",
        "L2",
        "L0.preferredName",
        "candidate secret",
        "L1.currentProject=API_KEY=secret",
      ]),
    ).toEqual([
      "L0.preferredName",
      "L0.occupation",
      "L0.longTermInterests",
      "L0.language",
      "L0.permanentNotes",
      "L1.currentProject",
      "L1.recentGoals",
      "L1.recentPreferences",
      "L2",
    ]);

    expect(
      (["recall", "judge", "write"] as const).map(
        getSafeMemoryWriteFailureMessage,
      ),
    ).toEqual([
      "Memory recall unavailable",
      "Memory judge unavailable",
      "Memory write unavailable",
    ]);
  });

  it("rejects unsafe memory event payload values at the type boundary", () => {
    const safeKey: SafeMemoryWriteKey = "L0.preferredName";
    const safeMessage: MemoryWriteFailureMessage = "Memory write unavailable";

    // @ts-expect-error Arbitrary write keys must not cross the event boundary.
    const unsafeKey: SafeMemoryWriteKey = "L0.secret";
    // @ts-expect-error Raw exception text must not cross the event boundary.
    const unsafeMessage: MemoryWriteFailureMessage = "API_KEY=secret";

    expect([safeKey, safeMessage, unsafeKey, unsafeMessage]).toEqual([
      "L0.preferredName",
      "Memory write unavailable",
      "L0.secret",
      "API_KEY=secret",
    ]);
  });

  it("constructs frozen memory events that cannot be changed through aliases", () => {
    const originalWrites = ["L1.currentProject", "candidate secret"];
    const finished = createMemoryWriteFinishedEvent({
      writtenCount: 1,
      skippedCount: 0,
      writes: originalWrites,
    });
    const failed = createMemoryWriteFailedEvent(
      "judge",
      new Error("API_KEY=secret"),
    );

    originalWrites[0] = "L2";
    originalWrites.push("sentinel-after-construction");

    const mutableAlias = finished.writes as unknown as SafeMemoryWriteKey[];
    expect(Object.isFrozen(finished)).toBe(true);
    expect(Object.isFrozen(finished.writes)).toBe(true);
    expect(Object.isFrozen(failed)).toBe(true);
    expect(() => mutableAlias.push("L2")).toThrow(TypeError);
    expect(finished.writes).toEqual(["L1.currentProject"]);
    expect(failed.message).toBe("Memory judge unavailable");
    expect(JSON.stringify([finished, failed])).not.toContain("secret");
    expect(JSON.stringify([finished, failed])).not.toContain(
      "sentinel-after-construction",
    );
  });

  it("rejects direct structural construction of branded memory events", () => {
    const directFinished = {
      type: "memory_write_finished",
      writtenCount: 1,
      skippedCount: 0,
      writes: ["L0.language"] as const,
      // @ts-expect-error Memory write events must be created by the factory.
    } satisfies AgentEvent;
    const directFailed = {
      type: "memory_write_failed",
      stage: "judge",
      message: "Memory judge unavailable",
      // @ts-expect-error Memory failure events must be created by the factory.
    } satisfies AgentEvent;

    expect(directFinished.writes).toEqual(["L0.language"]);
    expect(directFailed.message).toBe("Memory judge unavailable");
  });

  it("formats memory lifecycle events without exposing memory contents", () => {
    const untrustedWrites = [
      "L1.currentProject",
      "L1.currentProject",
      "L2",
      "candidate secret",
      "L1.currentProject=API_KEY=secret",
    ];
    const readonlyWrites = ["L0.language"] as const satisfies readonly string[];
    const finished = createMemoryWriteFinishedEvent({
      writtenCount: 1,
      skippedCount: 1,
      writes: untrustedWrites,
    });
    const readonlyFinished = createMemoryWriteFinishedEvent({
      writtenCount: 1,
      skippedCount: 0,
      writes: readonlyWrites,
    });
    const failed = createMemoryWriteFailedEvent("judge");
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
      finished,
      failed,
    ];

    expect(events.map(formatAgentEventForTerminal)).toEqual([
      "[memory] recall started",
      "[memory] recall finished mode=vector l0=true l1=true l2=2",
      "[memory] write scheduled pending=1",
      "[memory] judge started",
      "[memory] judge finished candidates=2",
      "[memory] write finished written=1 skipped=1 keys=L1.currentProject,L2",
      "[memory] write failed stage=judge message=Memory judge unavailable",
    ]);

    const payload = JSON.stringify(events);
    const output = events.map(formatAgentEventForTerminal).join("\n");
    expect(payload).not.toContain("candidate secret");
    expect(payload).not.toContain("API_KEY=secret");
    expect(output).not.toContain("candidate secret");
    expect(output).not.toContain("API_KEY=secret");
    expect(output).not.toContain("evidence");
    expect(readonlyFinished.writes).toEqual(["L0.language"]);
  });

  it("creates frozen content-free conflict and resolver events", () => {
    const events: AgentEvent[] = [
      createMemoryConflictDetectedEvent({ conflictId: "conflict-1", queuedCount: 2 }),
      createMemoryResolverStartedEvent({ conflictId: "conflict-1", attempt: 1 }),
      createMemoryResolverFinishedEvent({ conflictId: "conflict-1", status: "resolved" }),
      createMemoryResolverFailedEvent({ conflictId: "conflict-2", attempts: 3 }),
      createMemoryGovernanceChangedEvent({ changedCount: 1 }),
    ];

    expect(events.map(formatAgentEventForTerminal)).toEqual([
      "[memory] conflict detected id=conflict-1 queued=2",
      "[memory] resolver started id=conflict-1 attempt=1",
      "[memory] resolver finished id=conflict-1 status=resolved",
      "[memory] resolver failed id=conflict-2 attempts=3",
      "[memory] governance changed count=1",
    ]);
    expect(events.every(Object.isFrozen)).toBe(true);
    expect(JSON.stringify(events)).not.toContain("dark mode");
    expect(JSON.stringify(events)).not.toContain("model reason");
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

describe("memory intelligence events", () => {
  it("exposes counts only", () => {
    const event = createMemoryIntelligenceFinishedEvent({ proposedCount: 3, acceptedCount: 1, skippedCount: 2, compressedCount: 1, nodeCount: 4, relationCount: 2 });
    expect(formatAgentEventForTerminal(event)).toBe("[memory] intelligence proposed=3 accepted=1 skipped=2 compressed=1 nodes=4 relations=2");
    expect(Object.isFrozen(event)).toBe(true);
    expect(JSON.stringify(event)).not.toMatch(/content|evidence|reason/i);
  });
});
