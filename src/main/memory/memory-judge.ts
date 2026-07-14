import type { ModelConfig } from "../config/model-config.js";
import { requestChatCompletion } from "../vendors/chat-completion-client.js";
import type { VendorAdapter } from "../vendors/types.js";
import type { MemoryCandidate } from "./memory-types.js";

const l0Fields = new Set([
  "preferredName",
  "occupation",
  "longTermInterests",
  "language",
  "permanentNotes",
]);
const l1Fields = new Set([
  "currentProject",
  "recentGoals",
  "recentPreferences",
]);
const importanceValues = new Set(["low", "medium", "high"]);

const systemPrompt = `You extract durable user memories from a single conversation turn.
Return JSON only, with exactly this top-level shape: {"candidates":[]}.
Each candidate has layer, field, content, confidence, importance, evidenceQuote, and reason.
confidence must be a JSON number from 0 to 1, never a word or string.
importance must be exactly one of the JSON strings: "low", "medium", or "high".
L0 stores stable profile facts that are likely to remain useful across many conversations.
L1 stores current or recent state, goals, projects, and preferences that may change over time.
L2 stores specific past events or milestones that may be relevant to future questions.
L2 candidates must omit field.
Allowed layers and fields:
- L0: preferredName, occupation, longTermInterests, language, permanentNotes
- L1: currentProject, recentGoals, recentPreferences
- L2: no field
Valid L2 example: {"layer":"L2","content":"Completed milestone Alpha-7","confidence":0.95,"importance":"high","evidenceQuote":"I completed milestone Alpha-7","reason":"A durable past milestone"}
Only extract user facts supported by an exact evidenceQuote from the user message. Candidate content must not add facts, attributes, or implications absent from that evidenceQuote. Candidate content must be an exact continuous substring of evidenceQuote after ignoring only whitespace, punctuation, case, and Unicode normalization. Do not omit or reorder words. When uncertain, copy evidenceQuote exactly into content. For L2 events, copying the complete evidenceQuote is preferred over rewriting or summarizing it.
The assistant reply is context only and is never evidence. Do not save assistant claims, advice, guesses, or greetings.
credentials and authentication secrets must never be saved. Bank cards, identity numbers, passport identifiers, and exact addresses must never be saved even when requested. medical or legal privacy requires an explicit user request for long-term storage.
Return an empty candidates array when there is nothing durable to save.`;

export interface MemoryJudge {
  judge(input: {
    userMessage: string;
    assistantReply: string;
  }): Promise<MemoryCandidate[]>;
}

export function createMemoryJudge(options: {
  getConfig: () => ModelConfig;
  adapter: VendorAdapter;
  requestCompletion?: typeof requestChatCompletion;
  fetchImpl?: typeof fetch;
}): MemoryJudge {
  const requestCompletion = options.requestCompletion ?? requestChatCompletion;

  return {
    async judge(input) {
      const completion = await requestCompletion({
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `User message:\n${input.userMessage}\n\nAssistant reply:\n${input.assistantReply}`,
          },
        ],
        tools: [],
        config: options.getConfig(),
        adapter: options.adapter,
        fetchImpl: options.fetchImpl,
      });

      return parseCandidates(completion.text);
    },
  };
}

function parseCandidates(text: string): MemoryCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid memory judge response");
  }

  if (!isRecord(parsed)
    || Object.keys(parsed).length !== 1
    || !Object.hasOwn(parsed, "candidates")
    || !Array.isArray(parsed.candidates)) {
    throw new Error("Invalid memory judge response");
  }

  return parsed.candidates.flatMap((candidate) => {
    const parsedCandidate = parseCandidate(candidate);
    return parsedCandidate ? [parsedCandidate] : [];
  });
}

function parseCandidate(value: unknown): MemoryCandidate | undefined {
  if (!isRecord(value)
    || typeof value.layer !== "string"
    || typeof value.content !== "string"
    || typeof value.confidence !== "number"
    || !Number.isFinite(value.confidence)
    || value.confidence < 0
    || value.confidence > 1
    || typeof value.importance !== "string"
    || !importanceValues.has(value.importance)
    || typeof value.evidenceQuote !== "string"
    || typeof value.reason !== "string") {
    return undefined;
  }

  if (value.layer === "L0" && typeof value.field === "string" && l0Fields.has(value.field)) {
    return createCandidate(value, "L0", value.field);
  }
  if (value.layer === "L1" && typeof value.field === "string" && l1Fields.has(value.field)) {
    return createCandidate(value, "L1", value.field);
  }
  if (value.layer === "L2" && (value.field === undefined || value.field === null)) {
    return createCandidate(value, "L2");
  }
  return undefined;
}

function createCandidate(
  value: Record<string, unknown>,
  layer: MemoryCandidate["layer"],
  field?: string,
): MemoryCandidate {
  return {
    layer,
    ...(field === undefined ? {} : { field }),
    content: value.content as string,
    confidence: value.confidence as number,
    importance: value.importance as MemoryCandidate["importance"],
    evidenceQuote: value.evidenceQuote as string,
    reason: value.reason as string,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
