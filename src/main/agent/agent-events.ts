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

declare const memoryWriteEventBrand: unique symbol;
type MemoryWriteEventBrand = {
  readonly [memoryWriteEventBrand]: true;
};

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

type MemoryWriteFinishedEvent = {
  readonly type: "memory_write_finished";
  readonly writtenCount: number;
  readonly skippedCount: number;
  readonly writes: readonly SafeMemoryWriteKey[];
} & MemoryWriteEventBrand;

type MemoryWriteFailedEvent = {
  readonly type: "memory_write_failed";
  readonly stage: MemoryWriteFailureStage;
  readonly message: MemoryWriteFailureMessage;
} & MemoryWriteEventBrand;

declare const memoryGovernanceEventBrand: unique symbol;
type MemoryGovernanceEventBrand = {
  readonly [memoryGovernanceEventBrand]: true;
};

type MemoryConflictDetectedEvent = {
  readonly type: "memory_conflict_detected";
  readonly conflictId: string;
  readonly queuedCount: number;
} & MemoryGovernanceEventBrand;

type MemoryResolverStartedEvent = {
  readonly type: "memory_resolver_started";
  readonly conflictId: string;
  readonly attempt: number;
} & MemoryGovernanceEventBrand;

type MemoryResolverFinishedEvent = {
  readonly type: "memory_resolver_finished";
  readonly conflictId: string;
  readonly status: "resolved" | "uncertain" | "unchanged";
} & MemoryGovernanceEventBrand;

type MemoryResolverFailedEvent = {
  readonly type: "memory_resolver_failed";
  readonly conflictId: string;
  readonly attempts: number;
} & MemoryGovernanceEventBrand;

type MemoryGovernanceChangedEvent = {
  readonly type: "memory_governance_changed";
  readonly changedCount: number;
} & MemoryGovernanceEventBrand;

type MemoryMaintenanceStartedEvent = {
  readonly type: "memory_maintenance_started";
  readonly pendingCount: number;
} & MemoryGovernanceEventBrand;

type MemoryMaintenanceFinishedEvent = {
  readonly type: "memory_maintenance_finished";
  readonly activeToAging: number;
  readonly agingToArchived: number;
  readonly weightUpdated: number;
  readonly l1Expired: number;
} & MemoryGovernanceEventBrand;

type MemoryMaintenanceFailedEvent = {
  readonly type: "memory_maintenance_failed";
  readonly failedStepCount: number;
} & MemoryGovernanceEventBrand;

type MemoryIntelligenceFinishedEvent = {
  readonly type: "memory_intelligence_finished";
  readonly proposedCount: number;
  readonly acceptedCount: number;
  readonly skippedCount: number;
  readonly compressedCount: number;
  readonly nodeCount: number;
  readonly relationCount: number;
} & MemoryGovernanceEventBrand;

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
      type: "skill_activated";
      skillId: string;
    }
  | {
      type: "skill_reference_loaded";
      skillId: string;
      reference: string;
    }
  | {
      type: "skill_load_failed";
      skillId: string;
      code: string;
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
  | MemoryWriteFailedEvent
  | MemoryConflictDetectedEvent
  | MemoryResolverStartedEvent
  | MemoryResolverFinishedEvent
  | MemoryResolverFailedEvent
  | MemoryGovernanceChangedEvent
  | MemoryMaintenanceStartedEvent
  | MemoryMaintenanceFinishedEvent
  | MemoryMaintenanceFailedEvent
  | MemoryIntelligenceFinishedEvent;

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
  }) as MemoryWriteFinishedEvent;
}

export function createMemoryWriteFailedEvent(
  stage: MemoryWriteFailureStage,
  _error?: unknown,
): MemoryWriteFailedEvent {
  return Object.freeze({
    type: "memory_write_failed" as const,
    stage,
    message: getSafeMemoryWriteFailureMessage(stage),
  }) as MemoryWriteFailedEvent;
}

export function createMemoryConflictDetectedEvent(input: {
  conflictId: string;
  queuedCount: number;
}): MemoryConflictDetectedEvent {
  return Object.freeze({
    type: "memory_conflict_detected" as const,
    conflictId: input.conflictId,
    queuedCount: input.queuedCount,
  }) as MemoryConflictDetectedEvent;
}

export function createMemoryResolverStartedEvent(input: {
  conflictId: string;
  attempt: number;
}): MemoryResolverStartedEvent {
  return Object.freeze({
    type: "memory_resolver_started" as const,
    conflictId: input.conflictId,
    attempt: input.attempt,
  }) as MemoryResolverStartedEvent;
}

export function createMemoryResolverFinishedEvent(input: {
  conflictId: string;
  status: "resolved" | "uncertain" | "unchanged";
}): MemoryResolverFinishedEvent {
  return Object.freeze({
    type: "memory_resolver_finished" as const,
    conflictId: input.conflictId,
    status: input.status,
  }) as MemoryResolverFinishedEvent;
}

export function createMemoryResolverFailedEvent(input: {
  conflictId: string;
  attempts: number;
}): MemoryResolverFailedEvent {
  return Object.freeze({
    type: "memory_resolver_failed" as const,
    conflictId: input.conflictId,
    attempts: input.attempts,
  }) as MemoryResolverFailedEvent;
}

export function createMemoryGovernanceChangedEvent(input: {
  changedCount: number;
}): MemoryGovernanceChangedEvent {
  return Object.freeze({
    type: "memory_governance_changed" as const,
    changedCount: input.changedCount,
  }) as MemoryGovernanceChangedEvent;
}

export function createMemoryMaintenanceStartedEvent(input: {
  pendingCount: number;
}): MemoryMaintenanceStartedEvent {
  return Object.freeze({
    type: "memory_maintenance_started" as const,
    pendingCount: safeCount(input.pendingCount),
  }) as MemoryMaintenanceStartedEvent;
}

export function createMemoryMaintenanceFinishedEvent(input: {
  activeToAging: number;
  agingToArchived: number;
  weightUpdated: number;
  l1Expired: number;
}): MemoryMaintenanceFinishedEvent {
  return Object.freeze({
    type: "memory_maintenance_finished" as const,
    activeToAging: safeCount(input.activeToAging),
    agingToArchived: safeCount(input.agingToArchived),
    weightUpdated: safeCount(input.weightUpdated),
    l1Expired: safeCount(input.l1Expired),
  }) as MemoryMaintenanceFinishedEvent;
}

export function createMemoryMaintenanceFailedEvent(input: {
  failedStepCount: number;
}): MemoryMaintenanceFailedEvent {
  return Object.freeze({
    type: "memory_maintenance_failed" as const,
    failedStepCount: safeCount(input.failedStepCount),
  }) as MemoryMaintenanceFailedEvent;
}

export function createMemoryIntelligenceFinishedEvent(input: {
  proposedCount: number;
  acceptedCount: number;
  skippedCount: number;
  compressedCount: number;
  nodeCount: number;
  relationCount: number;
}): MemoryIntelligenceFinishedEvent {
  return Object.freeze({
    type: "memory_intelligence_finished" as const,
    proposedCount: safeCount(input.proposedCount),
    acceptedCount: safeCount(input.acceptedCount),
    skippedCount: safeCount(input.skippedCount),
    compressedCount: safeCount(input.compressedCount),
    nodeCount: safeCount(input.nodeCount),
    relationCount: safeCount(input.relationCount),
  }) as MemoryIntelligenceFinishedEvent;
}

export function countMemoryGovernanceChanges(input: {
  activeToAging: number;
  agingToArchived: number;
  weightUpdated: number;
  l1Expired: number;
}): number {
  const statusChanged = safeCount(input.activeToAging) + safeCount(input.agingToArchived);
  const weightOnly = Math.max(0, safeCount(input.weightUpdated) - statusChanged);
  return statusChanged + weightOnly + safeCount(input.l1Expired);
}

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
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
    case "skill_activated":
      return `[skill] activated id=${event.skillId}`;
    case "skill_reference_loaded":
      return `[skill] reference loaded id=${event.skillId} reference=${event.reference}`;
    case "skill_load_failed":
      return `[skill] load failed id=${event.skillId} code=${event.code}`;
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
    case "memory_conflict_detected":
      return `[memory] conflict detected id=${event.conflictId} queued=${event.queuedCount}`;
    case "memory_resolver_started":
      return `[memory] resolver started id=${event.conflictId} attempt=${event.attempt}`;
    case "memory_resolver_finished":
      return `[memory] resolver finished id=${event.conflictId} status=${event.status}`;
    case "memory_resolver_failed":
      return `[memory] resolver failed id=${event.conflictId} attempts=${event.attempts}`;
    case "memory_governance_changed":
      return `[memory] governance changed count=${event.changedCount}`;
    case "memory_maintenance_started":
      return `[memory] maintenance started pending=${event.pendingCount}`;
    case "memory_maintenance_finished":
      return `[memory] maintenance finished aging=${event.activeToAging} archived=${event.agingToArchived} weights=${event.weightUpdated} l1Expired=${event.l1Expired}`;
    case "memory_maintenance_failed":
      return `[memory] maintenance failed steps=${event.failedStepCount}`;
    case "memory_intelligence_finished":
      return `[memory] intelligence proposed=${event.proposedCount} accepted=${event.acceptedCount} skipped=${event.skippedCount} compressed=${event.compressedCount} nodes=${event.nodeCount} relations=${event.relationCount}`;
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
