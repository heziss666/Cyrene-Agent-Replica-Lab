export type SchedulerMissedRunPolicy = "skip" | "run-once";

export type SchedulerTaskSchedule =
  | { kind: "once"; runAt: string }
  | { kind: "interval"; every: number; unit: "minutes" | "hours" | "days" }
  | { kind: "cron"; expression: string };

export interface SchedulerTaskInput {
  name: string;
  prompt: string;
  schedule: SchedulerTaskSchedule;
  timezone: string;
  missedRunPolicy: SchedulerMissedRunPolicy;
  enabled: boolean;
}

export interface SchedulerTaskView extends SchedulerTaskInput {
  id: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SchedulerToolCallView {
  toolId: string;
  args: Record<string, unknown>;
  status: "succeeded" | "failed" | "blocked";
  startedAt: string;
  finishedAt?: string;
  outputSummary?: string;
  errorCode?: string;
  approvalRequired?: boolean;
}

export interface SchedulerRunView {
  id: string;
  taskId: string;
  trigger: "scheduled" | "catch-up" | "manual";
  status: "queued" | "running" | "succeeded" | "failed" | "needs_attention" | "skipped_overlap" | "cancelled_shutdown";
  scheduledFor: string;
  startedAt?: string;
  finishedAt?: string;
  reply?: string;
  toolCalls: SchedulerToolCallView[];
  errorCode?: string;
}

export interface SchedulerApi {
  listTasks(): Promise<{ tasks: SchedulerTaskView[] }>;
  createTask(input: SchedulerTaskInput): Promise<SchedulerTaskView>;
  updateTask(id: string, patch: Partial<SchedulerTaskInput>): Promise<SchedulerTaskView>;
  removeTask(id: string): Promise<{ removed: true }>;
  setEnabled(id: string, enabled: boolean): Promise<SchedulerTaskView>;
  runNow(id: string): Promise<{ runId: string }>;
  listRuns(taskId?: string): Promise<SchedulerRunView[]>;
  getRun(id: string): Promise<SchedulerRunView | undefined>;
  onChanged(listener: () => void): () => void;
}
