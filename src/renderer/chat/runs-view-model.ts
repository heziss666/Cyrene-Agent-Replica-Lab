import type { AgentRunRecord, AgentRunSource, AgentRunStatus, AgentRunSummary } from "../../main/runs/agent-run-types.js";

export interface RunsFilters {
  source: AgentRunSource | "all";
  status: AgentRunStatus | "all";
  query: string;
}

export function createRunsViewModel() {
  let runs: AgentRunSummary[] = [];
  let selected: AgentRunRecord | undefined;
  let filters: RunsFilters = { source: "all", status: "all", query: "" };
  return {
    setRuns(value: AgentRunSummary[]) { runs = value.map((run) => ({ ...run })); },
    setSelected(value: AgentRunRecord | undefined) {
      selected = value ? {
        ...structuredClone(value),
        events: [...value.events].sort((a, b) => a.sequence - b.sequence),
      } : undefined;
    },
    setFilters(patch: Partial<RunsFilters>) { filters = { ...filters, ...patch }; },
    snapshot() {
      const query = filters.query.trim().toLocaleLowerCase();
      const visible = runs.filter((run) =>
        (filters.source === "all" || run.source === filters.source)
        && (filters.status === "all" || run.status === filters.status)
        && (!query || `${run.runId} ${run.conversationId ?? ""} ${run.taskId ?? ""} ${run.error?.code ?? ""}`
          .toLocaleLowerCase().includes(query))
      );
      return { filters: { ...filters }, visible, selected: selected ? structuredClone(selected) : undefined };
    },
  };
}
