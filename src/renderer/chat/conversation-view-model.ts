import type { AgentRunEventEnvelope } from "../../main/runs/agent-run-types.js";

export interface LiveRunViewState {
  runId: string;
  conversationId: string;
  requestId: string;
  status: "queued" | "running";
  text: string;
  lastSequence: number;
}

export interface ConversationViewModelSnapshot {
  activeConversationId: string;
  busy: boolean;
  runningConversationId?: string;
  runningRequestId?: string;
  unreadConversationIds: string[];
  liveRuns: LiveRunViewState[];
}

export function createConversationViewModel(initialConversationId: string) {
  let activeConversationId = initialConversationId;
  const pendingRequests = new Map<string, string>();
  const liveRuns = new Map<string, LiveRunViewState>();
  const unread = new Set<string>();

  function finishSource(conversationId: string, requestId: string): boolean {
    const matches = pendingRequests.get(requestId) === conversationId;
    pendingRequests.delete(requestId);
    if (matches && conversationId !== activeConversationId) unread.add(conversationId);
    return matches && conversationId === activeConversationId;
  }

  return {
    setActive(conversationId: string) {
      activeConversationId = conversationId;
      unread.delete(conversationId);
    },
    beginRun(conversationId: string, requestId: string) {
      if (pendingRequests.has(requestId)) throw new Error("CHAT_REQUEST_DUPLICATE");
      pendingRequests.set(requestId, conversationId);
    },
    acceptRun(
      runId: string,
      conversationId: string,
      requestId: string,
      status: "queued" | "running",
    ) {
      const existing = liveRuns.get(runId);
      liveRuns.set(runId, existing ?? {
        runId,
        conversationId,
        requestId,
        status,
        text: "",
        lastSequence: 0,
      });
    },
    applyRunEvent(envelope: AgentRunEventEnvelope) {
      let run = liveRuns.get(envelope.runId);
      if (!run && envelope.conversationId && envelope.requestId) {
        run = {
          runId: envelope.runId,
          conversationId: envelope.conversationId,
          requestId: envelope.requestId,
          status: envelope.event.type === "run_started" ? "running" : "queued",
          text: "",
          lastSequence: 0,
        };
        liveRuns.set(run.runId, run);
      }
      if (!run || envelope.sequence <= run.lastSequence) {
        return { accepted: false, renderInActiveConversation: false, text: run?.text ?? "" };
      }
      run.lastSequence = envelope.sequence;
      if (envelope.event.type === "run_started") run.status = "running";
      if (envelope.event.type === "text_delta" && typeof envelope.event.delta === "string") {
        run.text += envelope.event.delta;
      }
      const terminal = envelope.event.type === "run_succeeded"
        || envelope.event.type === "run_failed"
        || envelope.event.type === "run_cancelled";
      const renderInActiveConversation = run.conversationId === activeConversationId;
      const text = run.text;
      if (terminal) {
        finishSource(run.conversationId, run.requestId);
        liveRuns.delete(run.runId);
      }
      return { accepted: true, renderInActiveConversation, text, terminal };
    },
    finishRun(input: { conversationId?: string; requestId?: string }) {
      const requestId = input.requestId;
      const source = input.conversationId ?? (requestId ? pendingRequests.get(requestId) : undefined);
      const matches = source !== undefined && requestId !== undefined
        && pendingRequests.get(requestId) === source;
      const renderInActiveConversation = matches ? finishSource(source, requestId) : false;
      return { renderInActiveConversation };
    },
    snapshot(): ConversationViewModelSnapshot {
      const activeRun = [...liveRuns.values()].find(({ conversationId }) =>
        conversationId === activeConversationId
      );
      const pending = [...pendingRequests.entries()].find(([, conversationId]) =>
        conversationId === activeConversationId
      );
      return {
        activeConversationId,
        busy: Boolean(activeRun || pending),
        runningConversationId: activeRun?.conversationId ?? pending?.[1],
        runningRequestId: activeRun?.requestId ?? pending?.[0],
        unreadConversationIds: [...unread],
        liveRuns: [...liveRuns.values()].map((run) => ({ ...run })),
      };
    },
  };
}
