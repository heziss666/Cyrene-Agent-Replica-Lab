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
Allowed layers and fields:
- L0: preferredName, occupation, longTermInterests, language, permanentNotes
- L1: currentProject, recentGoals, recentPreferences
- L2: no field
Only extract user facts supported by an exact evidenceQuote from the user message. Do not save assistant claims, advice, guesses, greetings, credentials, or sensitive information. Return an empty candidates array when there is nothing durable to save.`;

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

  if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) {
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
  if (value.layer === "L2" && value.field === undefined) {
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
