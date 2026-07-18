import { describe, expect, it } from "vitest";
import { loadConversationConfig } from "../../src/main/config/conversation-config.js";

describe("loadConversationConfig", () => {
  it("builds conversation paths and conservative defaults", () => {
    const config = loadConversationConfig({}, "C:/user-data");

    expect(config.rootDir.replaceAll("\\", "/")).toBe("C:/user-data/conversations");
    expect(config).toMatchObject({
      contextWindowTokens: 32_768,
      outputReserveTokens: 4_096,
      toolGrowthReserveTokens: 8_192,
      summaryTriggerTokens: 6_000,
      recentTurnTokens: 6_000,
    });
  });

  it("reads positive integer overrides", () => {
    expect(loadConversationConfig({
      CYRENE_MODEL_CONTEXT_TOKENS: "65536",
      CYRENE_MODEL_OUTPUT_RESERVE_TOKENS: "8192",
      CYRENE_AGENT_TOOL_GROWTH_RESERVE_TOKENS: "4096",
      CYRENE_CONVERSATION_SUMMARY_TRIGGER_TOKENS: "7000",
      CYRENE_CONVERSATION_RECENT_TURN_TOKENS: "5000",
    }, "C:/data")).toMatchObject({
      contextWindowTokens: 65_536,
      outputReserveTokens: 8_192,
      toolGrowthReserveTokens: 4_096,
      summaryTriggerTokens: 7_000,
      recentTurnTokens: 5_000,
    });
  });

  it("rejects invalid values and unusable budgets", () => {
    expect(() => loadConversationConfig({
      CYRENE_MODEL_CONTEXT_TOKENS: "many",
    }, "C:/data")).toThrow("CYRENE_MODEL_CONTEXT_TOKENS_MUST_BE_POSITIVE_INTEGER");

    expect(() => loadConversationConfig({
      CYRENE_MODEL_CONTEXT_TOKENS: "8192",
      CYRENE_MODEL_OUTPUT_RESERVE_TOKENS: "4096",
      CYRENE_AGENT_TOOL_GROWTH_RESERVE_TOKENS: "4096",
    }, "C:/data")).toThrow("CYRENE_CONVERSATION_TOKEN_BUDGET_INVALID");
  });
});
