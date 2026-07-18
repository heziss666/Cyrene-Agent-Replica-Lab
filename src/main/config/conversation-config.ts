import { join } from "node:path";

export interface ConversationConfig {
  rootDir: string;
  contextWindowTokens: number;
  outputReserveTokens: number;
  toolGrowthReserveTokens: number;
  summaryTriggerTokens: number;
  recentTurnTokens: number;
}

function readPositiveInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key}_MUST_BE_POSITIVE_INTEGER`);
  }
  return value;
}

export function loadConversationConfig(
  env: NodeJS.ProcessEnv = process.env,
  userDataDir: string,
): ConversationConfig {
  const contextWindowTokens = readPositiveInteger(
    env,
    "CYRENE_MODEL_CONTEXT_TOKENS",
    32_768,
  );
  const outputReserveTokens = readPositiveInteger(
    env,
    "CYRENE_MODEL_OUTPUT_RESERVE_TOKENS",
    4_096,
  );
  const toolGrowthReserveTokens = readPositiveInteger(
    env,
    "CYRENE_AGENT_TOOL_GROWTH_RESERVE_TOKENS",
    8_192,
  );
  if (
    contextWindowTokens - outputReserveTokens - toolGrowthReserveTokens < 4_096
  ) {
    throw new Error("CYRENE_CONVERSATION_TOKEN_BUDGET_INVALID");
  }

  return {
    rootDir: join(userDataDir, "conversations"),
    contextWindowTokens,
    outputReserveTokens,
    toolGrowthReserveTokens,
    summaryTriggerTokens: readPositiveInteger(
      env,
      "CYRENE_CONVERSATION_SUMMARY_TRIGGER_TOKENS",
      6_000,
    ),
    recentTurnTokens: readPositiveInteger(
      env,
      "CYRENE_CONVERSATION_RECENT_TURN_TOKENS",
      6_000,
    ),
  };
}
