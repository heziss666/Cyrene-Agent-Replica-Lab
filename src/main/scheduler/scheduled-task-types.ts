export type MissedRunPolicy = "skip" | "run-once";
export type ScheduledRunTrigger = "scheduled" | "catch-up" | "manual";
export type ScheduledRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "needs_attention"
  | "skipped_overlap"
  | "cancelled_shutdown";

export type TaskSchedule =
  | { kind: "once"; runAt: string }
  | { kind: "interval"; every: number; unit: "minutes" | "hours" | "days" }
  | { kind: "cron"; expression: string };

export interface ScheduledTaskInput {
  name: string;
  prompt: string;
  schedule: TaskSchedule;
  timezone: string;
  missedRunPolicy: MissedRunPolicy;
  enabled: boolean;
}

export interface ScheduledTask extends ScheduledTaskInput {
  id: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type ScheduledToolCallStatus = "succeeded" | "failed" | "blocked";

export interface ScheduledToolCallRecord {
  toolId: string;
  args: Record<string, unknown>;
  status: ScheduledToolCallStatus;
  startedAt: string;
  finishedAt?: string;
  outputSummary?: string;
  errorCode?: string;
  approvalRequired?: boolean;
}

export interface ScheduledTaskRun {
  id: string;
  taskId: string;
  trigger: ScheduledRunTrigger;
  status: ScheduledRunStatus;
  scheduledFor: string;
  startedAt?: string;
  finishedAt?: string;
  reply?: string;
  toolCalls: ScheduledToolCallRecord[];
  errorCode?: string;
  agentRunId?: string;
}

export interface ScheduledTasksFile {
  schemaVersion: 1;
  tasks: ScheduledTask[];
}

export interface ScheduledRunsFile {
  schemaVersion: 1;
  runs: ScheduledTaskRun[];
}
