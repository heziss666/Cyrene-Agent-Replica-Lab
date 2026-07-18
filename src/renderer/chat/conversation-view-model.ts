export interface ConversationViewModelSnapshot {
  activeConversationId: string;
  busy: boolean;
  runningConversationId?: string;
  runningRequestId?: string;
  unreadConversationIds: string[];
}

export function createConversationViewModel(initialConversationId: string) {
  let activeConversationId = initialConversationId;
  let runningConversationId: string | undefined;
  let runningRequestId: string | undefined;
  const unread = new Set<string>();

  return {
    setActive(conversationId: string) {
      activeConversationId = conversationId;
      unread.delete(conversationId);
    },
    beginRun(conversationId: string, requestId: string) {
      if (runningRequestId) throw new Error("CHAT_RUN_IN_PROGRESS");
      runningConversationId = conversationId;
      runningRequestId = requestId;
    },
    finishRun(input: { conversationId?: string; requestId?: string }) {
      const source = input.conversationId ?? runningConversationId;
      const matches = source !== undefined && input.requestId === runningRequestId;
      if (matches && source !== activeConversationId) unread.add(source);
      if (matches) {
        runningConversationId = undefined;
        runningRequestId = undefined;
      }
      return { renderInActiveConversation: matches && source === activeConversationId };
    },
    snapshot(): ConversationViewModelSnapshot {
      return {
        activeConversationId,
        busy: runningRequestId !== undefined,
        runningConversationId,
        runningRequestId,
        unreadConversationIds: [...unread],
      };
    },
  };
}
