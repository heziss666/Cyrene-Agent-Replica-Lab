import type { ChatMessage } from "../../shared/chat-types.js";

export interface ConversationTurn {
  messages: ChatMessage[];
}

function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    ...(message.toolCalls
      ? { toolCalls: message.toolCalls.map((call) => ({ ...call })) }
      : {}),
  }));
}

export function groupConversationTurns(messages: ChatMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let current: ChatMessage[] | undefined;
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "user") {
      if (current) turns.push({ messages: cloneMessages(current) });
      current = [message];
      continue;
    }
    if (current) current.push(message);
  }
  if (current) turns.push({ messages: cloneMessages(current) });
  return turns;
}

export function selectRecentCompleteTurns(
  turns: ConversationTurn[],
  budget: number,
  estimateMessages: (messages: ChatMessage[]) => number,
): ConversationTurn[] {
  if (budget <= 0) return [];
  const selected: ConversationTurn[] = [];
  let used = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const cost = estimateMessages(turn.messages);
    if (used + cost > budget) break;
    selected.unshift({ messages: cloneMessages(turn.messages) });
    used += cost;
  }
  return selected;
}
