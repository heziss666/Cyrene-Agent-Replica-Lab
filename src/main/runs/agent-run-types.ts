export const AGENT_RUN_SCHEMA_VERSION = 1 as const;
export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type AgentRunSource = "chat" | "scheduler";

export interface AgentRunIdentity {
  runId: string;
  parentRunId?: string;
  source: AgentRunSource;
  conversationId?: string;
  requestId?: string;
  taskId?: string;
}

export interface AgentRunUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source: "provider" | "estimated";
}

export interface AgentRunError {
  code: string;
  category: "cancelled" | "timeout" | "network" | "provider" | "tool" | "validation" | "internal";
  retryable: boolean;
  safeMessage: string;
  httpStatus?: number;
  causePreview?: string;
}

export interface AgentRunTraceEvent {
  sequence: number;
  timestamp: string;
  type: string;
  durationMs?: number;
  data?: unknown;
}

export interface AgentRunRecord extends AgentRunIdentity {
  schemaVersion: typeof AGENT_RUN_SCHEMA_VERSION;
  status: AgentRunStatus;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  roundsUsed: number;
  modelCallCount: number;
  toolCallCount: number;
  usage: AgentRunUsage;
  error?: AgentRunError;
  events: AgentRunTraceEvent[];
}

export type AgentRunSummary = Omit<AgentRunRecord, "events">;

export interface AgentRunEventEnvelope {
  runId: string;
  conversationId?: string;
  requestId?: string;
  sequence: number;
  timestamp: string;
  event: { type: string; [key: string]: unknown };
}
