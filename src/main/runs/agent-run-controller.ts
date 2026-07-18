import type { AgentRunRecord, AgentRunTraceEvent } from "./agent-run-types.js";
import { sanitizeTraceValue } from "./trace-sanitizer.js";

export function createAgentRunController(record: AgentRunRecord, options: { now: () => string; onTrace?: (event: AgentRunTraceEvent) => void }) {
  const abortController = new AbortController(); let sequence = record.events.length;
  return {
    signal: abortController.signal,
    abort: () => abortController.abort(),
    emit(type: string, data?: unknown) {
      const event: AgentRunTraceEvent = { sequence: ++sequence, timestamp: options.now(), type, ...(data === undefined ? {} : { data: sanitizeTraceValue(data) }) };
      record.events.push(event); options.onTrace?.(structuredClone(event)); return event;
    },
  };
}
