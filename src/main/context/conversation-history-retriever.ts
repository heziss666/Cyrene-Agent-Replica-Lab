import type { EmbeddingProvider } from "../rag/embedding-provider.js";
import { hashText } from "../rag/text-hash.js";
import { cosineSimilarity } from "../rag/vector-math.js";
import type { ConversationMessage, ConversationRecord } from "../conversations/conversation-types.js";
import type { ConversationVectorIndex } from "./conversation-vector-index.js";

export interface ConversationHistoryExcerpt {
  conversationId: string;
  turnId: string;
  chunkId: string;
  messageIds: string[];
  text: string;
  createdAt: string;
  score: number;
}

export interface ConversationHistoryResult {
  mode: "hybrid" | "keyword";
  excerpts: ConversationHistoryExcerpt[];
}

export interface ConversationHistoryRetriever {
  indexConversation(record: ConversationRecord): Promise<{ indexed: number; pending: number }>;
  retrieve(input: {
    record: ConversationRecord;
    query: string;
    recentMessageIds: Set<string>;
    pinnedMessageIds: Set<string>;
    topK: number;
  }): Promise<ConversationHistoryResult>;
  removeConversation(id: string): Promise<number>;
  flush(): Promise<void>;
}

interface HistoryChunk {
  conversationId: string;
  turnId: string;
  chunkId: string;
  messageIds: string[];
  text: string;
  textHash: string;
  createdAt: string;
}

function completedTurns(messages: ConversationMessage[]): ConversationMessage[][] {
  const turns: ConversationMessage[][] = [];
  let current: ConversationMessage[] | undefined;
  for (const message of messages.filter(({ status }) => status === "complete")) {
    if (message.role === "user") {
      if (current) turns.push(current);
      current = [message];
    } else if (current) current.push(message);
  }
  if (current) turns.push(current);
  return turns;
}

function turnText(turn: ConversationMessage[]): string {
  const user = turn.find(({ role }) => role === "user");
  const assistant = [...turn].reverse().find(({ role, content }) => role === "assistant" && content.trim());
  const toolNames = new Set<string>();
  for (const message of turn) {
    if (message.name) toolNames.add(message.name);
    for (const call of message.toolCalls ?? []) toolNames.add(call.name);
  }
  return [
    user ? `User: ${user.content}` : "",
    toolNames.size > 0 ? `Tools used: ${[...toolNames].join(", ")}` : "",
    assistant ? `Assistant: ${assistant.content}` : "",
  ].filter(Boolean).join("\n");
}

function splitText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    const candidate = remaining.slice(0, maxChars);
    const boundary = Math.max(candidate.lastIndexOf("\n"), candidate.lastIndexOf("。"), candidate.lastIndexOf(". "));
    const cut = boundary > Math.floor(maxChars / 2) ? boundary + 1 : maxChars;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function chunksFor(record: ConversationRecord, maxChars: number): HistoryChunk[] {
  return completedTurns(record.messages).flatMap((turn) => {
    const user = turn.find(({ role }) => role === "user")!;
    const text = turnText(turn);
    if (!text.trim()) return [];
    return splitText(text, maxChars).map((part, index) => ({
      conversationId: record.id,
      turnId: user.id,
      chunkId: `${user.id}_part_${index + 1}`,
      messageIds: turn.map(({ id }) => id),
      text: part,
      textHash: hashText(part),
      createdAt: user.createdAt,
    }));
  });
}

function keywordScore(query: string, text: string): number {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const normalizedText = text.toLocaleLowerCase();
  if (!normalizedQuery) return 0;
  let score = normalizedText.includes(normalizedQuery) ? 4 : 0;
  const terms = normalizedQuery.match(/[\p{L}\p{N}_.-]+/gu) ?? [];
  for (const term of new Set(terms)) if (normalizedText.includes(term)) score += 1;
  return score;
}

export function createConversationHistoryRetriever(options: {
  provider: EmbeddingProvider;
  index: ConversationVectorIndex;
  chunkSizeChars?: number;
}): ConversationHistoryRetriever {
  const maxChars = options.chunkSizeChars ?? 2_000;

  async function indexConversation(record: ConversationRecord) {
    const chunks = chunksFor(record, maxChars);
    await options.index.pruneConversation(record.id, chunks.map(({ chunkId, textHash }) => ({ chunkId, textHash })));
    const missing = chunks.filter((chunk) => !options.index.get(record.id, chunk.chunkId, chunk.textHash));
    if (missing.length === 0) return { indexed: 0, pending: 0 };
    try {
      const vectors = await options.provider.embedDocuments(missing.map(({ text }) => text));
      if (vectors.length !== missing.length) throw new Error("CONVERSATION_EMBEDDING_COUNT_INVALID");
      await options.index.addMany(missing.map((chunk, index) => ({
        conversationId: record.id,
        chunkId: chunk.chunkId,
        textHash: chunk.textHash,
        vector: vectors[index],
      })));
      return { indexed: missing.length, pending: 0 };
    } catch {
      return { indexed: 0, pending: missing.length };
    }
  }

  return {
    indexConversation,

    async retrieve(input) {
      const chunks = chunksFor(input.record, maxChars).filter((chunk) =>
        !chunk.messageIds.some((id) => input.recentMessageIds.has(id) || input.pinnedMessageIds.has(id))
      );
      if (!input.query.trim() || input.topK <= 0 || chunks.length === 0) {
        return { mode: "keyword", excerpts: [] };
      }
      await indexConversation(input.record);
      const keywordRank = [...chunks]
        .map((chunk) => ({ chunk, score: keywordScore(input.query, chunk.text) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.chunk.chunkId.localeCompare(b.chunk.chunkId));
      let mode: "hybrid" | "keyword" = "keyword";
      let vectorRank: Array<{ chunk: HistoryChunk; score: number }> = [];
      try {
        const previous = completedTurns(input.record.messages).at(-2);
        const queryText = previous
          ? `Previous topic:\n${turnText(previous).slice(0, 1_000)}\nCurrent question:\n${input.query}`
          : input.query;
        const queryVector = await options.provider.embedQuery(queryText);
        vectorRank = chunks.map((chunk) => {
          const vector = options.index.get(input.record.id, chunk.chunkId, chunk.textHash);
          return { chunk, score: vector && vector.length === queryVector.length ? cosineSimilarity(queryVector, vector) : -1 };
        }).filter(({ score }) => score >= 0.2).sort((a, b) => b.score - a.score || a.chunk.chunkId.localeCompare(b.chunk.chunkId));
        mode = "hybrid";
      } catch {
        mode = "keyword";
      }

      const fused = new Map<string, { chunk: HistoryChunk; score: number }>();
      const addRanks = (ranked: Array<{ chunk: HistoryChunk }>) => ranked.forEach(({ chunk }, index) => {
        const current = fused.get(chunk.chunkId) ?? { chunk, score: 0 };
        current.score += 1 / (60 + index + 1);
        fused.set(chunk.chunkId, current);
      });
      if (mode === "hybrid") addRanks(vectorRank);
      addRanks(keywordRank);
      const selected = [...fused.values()]
        .sort((a, b) => b.score - a.score || a.chunk.createdAt.localeCompare(b.chunk.createdAt))
        .slice(0, Math.min(input.topK, 5))
        .sort((a, b) => a.chunk.createdAt.localeCompare(b.chunk.createdAt));
      return {
        mode,
        excerpts: selected.map(({ chunk, score }) => ({
          conversationId: chunk.conversationId,
          turnId: chunk.turnId,
          chunkId: chunk.chunkId,
          messageIds: [...chunk.messageIds],
          text: chunk.text,
          createdAt: chunk.createdAt,
          score,
        })),
      };
    },

    removeConversation: (id) => options.index.removeConversation(id),
    flush: () => options.index.flush(),
  };
}
