export interface AgentRunQueueItem { id: string; conversationId?: string; run(): Promise<void> }
export interface AgentRunQueue {
  enqueue(item: AgentRunQueueItem): "running" | "queued";
  cancel(id: string): boolean;
  beginShutdown(): void;
  pendingCount(): number;
  activeCount(): number;
  flushTick(): Promise<void>;
  flush(): Promise<void>;
}

export function createAgentRunQueue(options: { maxConcurrent: number }): AgentRunQueue {
  if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent <= 0) throw new Error("AGENT_RUN_MAX_CONCURRENT_INVALID");
  const waiting: AgentRunQueueItem[] = []; const active = new Map<string, AgentRunQueueItem>();
  const activeConversations = new Set<string>(); const inFlight = new Set<Promise<void>>(); let shuttingDown = false;
  function canRun(item: AgentRunQueueItem): boolean { return active.size < options.maxConcurrent && (!item.conversationId || !activeConversations.has(item.conversationId)); }
  function start(item: AgentRunQueueItem): void {
    active.set(item.id, item); if (item.conversationId) activeConversations.add(item.conversationId);
    const promise = Promise.resolve().then(item.run).catch(() => undefined).finally(() => {
      active.delete(item.id); if (item.conversationId) activeConversations.delete(item.conversationId);
      inFlight.delete(promise); pump();
    });
    inFlight.add(promise);
  }
  function pump(): void {
    while (active.size < options.maxConcurrent) {
      const index = waiting.findIndex(canRun); if (index < 0) return;
      const [item] = waiting.splice(index, 1); start(item);
    }
  }
  return {
    enqueue(item) {
      if (shuttingDown) throw new Error("AGENT_RUN_QUEUE_SHUTTING_DOWN");
      if (active.has(item.id) || waiting.some(({ id }) => id === item.id)) throw new Error("AGENT_RUN_DUPLICATE");
      if (canRun(item)) { start(item); return "running"; }
      waiting.push(item); return "queued";
    },
    cancel(id) { const index = waiting.findIndex((item) => item.id === id); if (index < 0) return false; waiting.splice(index, 1); return true; },
    beginShutdown() { shuttingDown = true; },
    pendingCount: () => waiting.length,
    activeCount: () => active.size,
    flushTick: () => new Promise((resolve) => setTimeout(resolve, 0)),
    async flush() { while (waiting.length || inFlight.size) { await Promise.all([...inFlight]); if (!inFlight.size && waiting.length) pump(); } },
  };
}
