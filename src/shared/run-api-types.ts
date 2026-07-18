import type {
  AgentRunEventEnvelope,
  AgentRunRecord,
  AgentRunSummary,
} from "../main/runs/agent-run-types.js";

export interface RunCancelResult { cancelled: boolean }
export interface RunRemoveResult { removed: true }
export interface RunClearResult { cleared: true }
export interface RunExportResult { exported: boolean }
export interface RunsChangedPayload { runs: AgentRunSummary[] }

export interface RunsApi {
  list(): Promise<AgentRunSummary[]>;
  get(runId: string): Promise<AgentRunRecord | undefined>;
  cancel(runId: string): Promise<RunCancelResult>;
  remove(runId: string): Promise<RunRemoveResult>;
  clear(): Promise<RunClearResult>;
  export(runId: string): Promise<RunExportResult>;
  onChanged(listener: (payload: RunsChangedPayload) => void): () => void;
  onEvent(listener: (payload: AgentRunEventEnvelope) => void): () => void;
}
