import type { AgentRunRecord } from "./agent-run-types.js";

export function applyRunRetention(records: AgentRunRecord[], options: {
  now: Date; maxAgeMs: number; maxRecords: number;
}): { kept: AgentRunRecord[]; removed: AgentRunRecord[] } {
  const cutoff = options.now.getTime() - options.maxAgeMs;
  const sorted = [...records].sort((a, b) => b.queuedAt.localeCompare(a.queuedAt) || a.runId.localeCompare(b.runId));
  const fresh = sorted.filter((record) => Date.parse(record.queuedAt) >= cutoff);
  const kept = fresh.slice(0, Math.max(0, options.maxRecords));
  const ids = new Set(kept.map(({ runId }) => runId));
  return { kept, removed: sorted.filter(({ runId }) => !ids.has(runId)) };
}
