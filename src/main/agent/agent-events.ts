export type SafeMemoryWriteKey =
  | "L0.preferredName"
  | "L0.occupation"
  | "L0.longTermInterests"
  | "L0.language"
  | "L0.permanentNotes"
  | "L1.currentProject"
  | "L1.recentGoals"
  | "L1.recentPreferences"
  | "L2";

export type MemoryWriteFailureStage = "recall" | "judge" | "write";

export type MemoryWriteFailureMessage =
  | "Memory recall unavailable"
  | "Memory judge unavailable"
  | "Memory write unavailable";

const SAFE_MEMORY_WRITE_KEYS: ReadonlySet<string> = new Set([
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

function isSafeMemoryWriteKey(value: string): value is SafeMemoryWriteKey {
  return SAFE_MEMORY_WRITE_KEYS.has(value);
}

export function filterSafeMemoryWriteKeys(
  writes: readonly string[],
): readonly SafeMemoryWriteKey[] {
  const safeWrites: SafeMemoryWriteKey[] = [];
  const seen = new Set<SafeMemoryWriteKey>();
  for (const write of writes) {
    if (!isSafeMemoryWriteKey(write) || seen.has(write)) continue;
    seen.add(write);
    safeWrites.push(write);
  }
  return safeWrites;
}

export function getSafeMemoryWriteFailureMessage(
  stage: MemoryWriteFailureStage,
): MemoryWriteFailureMessage {
  switch (stage) {
    case "recall":
      return "Memory recall unavailable";
    case "judge":
      return "Memory judge unavailable";
    case "write":
      return "Memory write unavailable";
  }
}

export interface MemoryWriteFinishedEvent {
  readonly type: "memory_write_finished";
  readonly writtenCount: number;
  readonly skippedCount: number;
  readonly writes: readonly SafeMemoryWriteKey[];
}

export interface MemoryWriteFailedEvent {
  readonly type: "memory_write_failed";
  readonly stage: MemoryWriteFailureStage;
  readonly message: MemoryWriteFailureMessage;
}

export type AgentEvent =
  | {
      type: "run_started";
      inputMessageCount: number;
      maxRounds: number;
    }
  | {
      type: "model_call_started";
      round: number;
      messageCount: number;
      toolCount: number;
    }
  | {
      type: "model_call_finished";
      round: number;
      text: string;
      toolCallCount: number;
    }
  | {
      type: "tool_call_started";
      round: number;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_call_finished";
      round: number;
      toolCallId: string;
      toolName: string;
      output: string;
    }
  | {
      type: "final_reply";
      round: number;
      text: string;
    }
  | {
      type: "run_finished";
      roundsUsed: number;
      toolResultCount: number;
    }
  | {
      type: "run_error";
      message: string;
    }
  | {
      type: "memory_recall_started";
    }
  | {
      type: "memory_recall_finished";
      l0Included: boolean;
      l1Included: boolean;
      l2Count: number;
      mode: "vector" | "keyword-fallback";
    }
  | {
      type: "memory_write_scheduled";
      pendingCount: number;
    }
  | {
      type: "memory_judge_started";
    }
  | {
      type: "memory_judge_finished";
      candidateCount: number;
    }
  | MemoryWriteFinishedEvent
  | MemoryWriteFailedEvent;

export interface CreateMemoryWriteFinishedEventInput {
  writtenCount: number;
  skippedCount: number;
  writes: readonly string[];
}

export function createMemoryWriteFinishedEvent(
  input: CreateMemoryWriteFinishedEventInput,
): MemoryWriteFinishedEvent {
  const writes = Object.freeze([...filterSafeMemoryWriteKeys(input.writes)]);
  return Object.freeze({
    type: "memory_write_finished" as const,
    writtenCount: input.writtenCount,
    skippedCount: input.skippedCount,
    writes,
  });
}

export function createMemoryWriteFailedEvent(
  stage: MemoryWriteFailureStage,
  _error?: unknown,
): MemoryWriteFailedEvent {
  return Object.freeze({
    type: "memory_write_failed" as const,
    stage,
    message: getSafeMemoryWriteFailureMessage(stage),
  });
}

export interface AgentTraceCollector {
  events: AgentEvent[];
  onEvent: (event: AgentEvent) => void;
}

function preview(value: string, maxLength = 155): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength)}...` : singleLine;
}

export function formatAgentEventForTerminal(event: AgentEvent): string {
  switch (event.type) {
    case "run_started":
      return `[run] started messages=${event.inputMessageCount} maxRounds=${event.maxRounds}`;
    case "model_call_started":
      return `[model] round ${event.round} -> messages=${event.messageCount} tools=${event.toolCount}`;
    case "model_call_finished":
      return `[model] round ${event.round} <- toolCalls=${event.toolCallCount}`;
    case "tool_call_started":
      return `[tool] round ${event.round} -> ${event.toolName} args=${JSON.stringify(event.args)}`;
    case "tool_call_finished":
      return `[tool] round ${event.round} <- ${event.toolName} result=${preview(event.output)}`;
    case "final_reply":
      return `[agent] round ${event.round} final=${preview(event.text)}`;
    case "run_finished":
      return `[run] finished rounds=${event.roundsUsed} toolResults=${event.toolResultCount}`;
    case "run_error":
      return `[run] error ${preview(event.message)}`;
    case "memory_recall_started":
      return "[memory] recall started";
    case "memory_recall_finished":
      return `[memory] recall finished mode=${event.mode} l0=${event.l0Included} l1=${event.l1Included} l2=${event.l2Count}`;
    case "memory_write_scheduled":
      return `[memory] write scheduled pending=${event.pendingCount}`;
    case "memory_judge_started":
      return "[memory] judge started";
    case "memory_judge_finished":
      return `[memory] judge finished candidates=${event.candidateCount}`;
    case "memory_write_finished": {
      const writes = filterSafeMemoryWriteKeys(event.writes);
      return `[memory] write finished written=${event.writtenCount} skipped=${event.skippedCount} keys=${writes.join(",") || "none"}`;
    }
    case "memory_write_failed":
      return `[memory] write failed stage=${event.stage} message=${getSafeMemoryWriteFailureMessage(event.stage)}`;
  }
}

export function createAgentTraceCollector(): AgentTraceCollector {
  const events: AgentEvent[] = [];
  return {
    events,
    onEvent: (event) => {
      events.push(event);
    },
  };
}
