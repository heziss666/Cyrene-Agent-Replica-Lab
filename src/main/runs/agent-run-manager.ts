import { randomUUID } from "node:crypto";
import type { AgentRunStore } from "./agent-run-store.js";
import { createAgentRunController } from "./agent-run-controller.js";
import { normalizeAgentRunError } from "./agent-run-error.js";
import { createAgentRunQueue } from "./agent-run-queue.js";
import { AGENT_RUN_SCHEMA_VERSION, type AgentRunEventEnvelope, type AgentRunIdentity, type AgentRunRecord, type AgentRunSummary } from "./agent-run-types.js";
import { createUsageCollector, type UsageInput } from "./usage-collector.js";

export interface AgentRunExecutionContext { runId: string; signal: AbortSignal; emit(type: string, data?: unknown): void; recordUsage(value: UsageInput): void }
export interface AgentRunManager {
  submit(input: Omit<AgentRunIdentity, "runId"> & { execute(context: AgentRunExecutionContext): Promise<void> }): Promise<{ runId: string; status: "queued" | "running" }>;
  cancel(id: string): Promise<boolean>; list(): Promise<AgentRunSummary[]>; get(id: string): Promise<AgentRunRecord | undefined>;
  wait(id: string): Promise<AgentRunRecord | undefined>;
  pendingCount(): number;
  remove(id: string): Promise<void>; clear(): Promise<void>; beginShutdown(): Promise<void>; flush(): Promise<void>;
}

export function createAgentRunManager(options: { store: AgentRunStore; maxConcurrent: number; idFactory?: () => string; now?: () => string; onEvent?: (event: AgentRunEventEnvelope) => void }): AgentRunManager {
  const now = options.now ?? (() => new Date().toISOString()); const idFactory = options.idFactory ?? (() => `run_${randomUUID()}`);
  const queue = createAgentRunQueue({ maxConcurrent: options.maxConcurrent });
  const controllers = new Map<string, ReturnType<typeof createAgentRunController>>(); const records = new Map<string, AgentRunRecord>();
  const completions = new Map<string, Promise<void>>();
  const completionResolvers = new Map<string, () => void>();
  let shuttingDown = false;
  const persist = (record: AgentRunRecord) => options.store.save(structuredClone(record));
  return {
    async submit(input) {
      if (shuttingDown) throw new Error("AGENT_RUN_QUEUE_SHUTTING_DOWN");
      const runId = idFactory(); const usage = createUsageCollector();
      let resolveCompletion!: () => void;
      completions.set(runId, new Promise<void>((resolve) => { resolveCompletion = resolve; }));
      completionResolvers.set(runId, resolveCompletion);
      const record: AgentRunRecord = { schemaVersion: AGENT_RUN_SCHEMA_VERSION, runId, source: input.source, ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}), ...(input.conversationId ? { conversationId: input.conversationId } : {}), ...(input.requestId ? { requestId: input.requestId } : {}), ...(input.taskId ? { taskId: input.taskId } : {}), status: "queued", queuedAt: now(), roundsUsed: 0, modelCallCount: 0, toolCallCount: 0, usage: usage.snapshot(), events: [] };
      const controller = createAgentRunController(record, { now, onTrace: (event) => options.onEvent?.({ runId, ...(record.conversationId ? { conversationId: record.conversationId } : {}), ...(record.requestId ? { requestId: record.requestId } : {}), sequence: event.sequence, timestamp: event.timestamp, event: { type: event.type, ...(event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {}) } }) });
      records.set(runId, record); controllers.set(runId, controller); controller.emit("run_queued"); await persist(record);
      const status = queue.enqueue({ id: runId, conversationId: record.conversationId, run: async () => {
        record.status = "running"; record.startedAt = now(); controller.emit("run_started"); await persist(record);
        try {
          if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
          await input.execute({ runId, signal: controller.signal, emit: controller.emit, recordUsage: (value) => { usage.add(value); record.usage = usage.snapshot(); } });
          if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
          record.status = "succeeded"; controller.emit("run_succeeded");
        } catch (error) {
          record.error = normalizeAgentRunError(error); record.status = record.error.category === "cancelled" ? "cancelled" : "failed";
          controller.emit(record.status === "cancelled" ? "run_cancelled" : "run_failed", { code: record.error.code });
        } finally { record.finishedAt = now(); record.usage = usage.snapshot(); await persist(record); controllers.delete(runId); records.delete(runId); completionResolvers.get(runId)?.(); completionResolvers.delete(runId); completions.delete(runId); }
      }});
      return { runId, status };
    },
    async cancel(id) {
      const record = records.get(id) ?? await options.store.load(id); if (!record || ["succeeded", "failed", "cancelled"].includes(record.status)) return false;
      const controller = controllers.get(id); controller?.emit("run_cancel_requested");
      if (record.status === "queued" && queue.cancel(id)) { record.status = "cancelled"; record.finishedAt = now(); controller?.emit("run_cancelled"); await persist(record); controllers.delete(id); records.delete(id); completionResolvers.get(id)?.(); completionResolvers.delete(id); completions.delete(id); return true; }
      controller?.abort(); return true;
    },
    async wait(id) { await (completions.get(id) ?? Promise.resolve()); completions.delete(id); return options.store.load(id); },
    pendingCount: () => queue.pendingCount() + queue.activeCount(),
    list: () => options.store.list(), get: (id) => options.store.load(id), remove: (id) => options.store.remove(id), clear: () => options.store.clear(),
    async beginShutdown() { shuttingDown = true; queue.beginShutdown(); for (const controller of controllers.values()) controller.abort(); await queue.flush(); await options.store.flush(); },
    async flush() { await queue.flush(); await options.store.flush(); },
  };
}
