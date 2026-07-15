import {
  filterSafeMemoryWriteKeys,
  getSafeMemoryWriteFailureMessage,
  type AgentEvent,
} from "../../main/agent/agent-events.js";
import type { ChatAgentEventPayload } from "../../shared/electron-api.js";

export function formatRendererEvent(event: AgentEvent): string {
  switch (event.type) {
    case "run_started":
      return `Run started: ${event.inputMessageCount} messages, max ${event.maxRounds} rounds`;
    case "model_call_started":
      return `Model round ${event.round} started: ${event.messageCount} messages, ${event.toolCount} tools`;
    case "model_call_finished":
      return `Model round ${event.round} finished: ${event.toolCallCount} tool calls`;
    case "tool_call_started":
      return `Tool ${event.toolName} started with ${JSON.stringify(event.args)}`;
    case "tool_call_finished":
      return `Tool ${event.toolName} finished: ${event.output}`;
    case "final_reply":
      return `Final reply in round ${event.round}`;
    case "run_finished":
      return `Run finished: ${event.roundsUsed} rounds, ${event.toolResultCount} tool results`;
    case "run_error":
      return `Run failed: ${event.message}`;
    case "memory_recall_started":
      return "Memory recall started";
    case "memory_recall_finished":
      return `Memory recall finished: mode=${event.mode}, L0=${event.l0Included ? "yes" : "no"}, L1=${event.l1Included ? "yes" : "no"}, L2=${event.l2Count}`;
    case "memory_write_scheduled":
      return `Memory write scheduled: ${event.pendingCount} pending`;
    case "memory_judge_started":
      return "Memory judge started";
    case "memory_judge_finished":
      return `Memory judge finished: ${event.candidateCount} candidates`;
    case "memory_write_finished": {
      const writes = filterSafeMemoryWriteKeys(event.writes);
      return `Memory write finished: ${event.writtenCount} written, ${event.skippedCount} skipped (keys: ${writes.join(", ") || "none"})`;
    }
    case "memory_write_failed":
      return `Memory write failed during ${event.stage}: ${getSafeMemoryWriteFailureMessage(event.stage)}`;
    case "memory_conflict_detected":
      return `Memory conflict detected: ${event.conflictId} (${event.queuedCount} queued)`;
    case "memory_resolver_started":
      return `Memory resolver started: ${event.conflictId} (attempt ${event.attempt})`;
    case "memory_resolver_finished":
      return `Memory resolver finished: ${event.conflictId} (${event.status})`;
    case "memory_resolver_failed":
      return `Memory resolver failed: ${event.conflictId} (${event.attempts} attempts)`;
    case "memory_governance_changed":
      return `Memory governance changed: ${event.changedCount} update${event.changedCount === 1 ? "" : "s"}`;
    case "memory_maintenance_started":
      return `Memory maintenance started: ${event.pendingCount} pending`;
    case "memory_maintenance_finished":
      return `Memory maintenance finished: ${event.activeToAging} aging, ${event.agingToArchived} archived, ${event.weightUpdated} weights, ${event.l1Expired} L1 expired`;
    case "memory_maintenance_failed":
      return `Memory maintenance failed: ${event.failedStepCount} step${event.failedStepCount === 1 ? "" : "s"}`;
  }
}

export function formatRendererErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `请求失败：${message}`;
}

export function formatRendererEventPayload(payload: ChatAgentEventPayload): string {
  return `[${payload.runId}] ${formatRendererEvent(payload.event)}`;
}
