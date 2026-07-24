import { describe, expect, it } from "vitest";
import { decideCurrencyWarGuidanceRetrieval } from "../../../src/main/currency-war/rag/currency-war-guidance-policy.js";

describe("Currency War guidance retrieval policy", () => {
  it("retrieves general guidance for an operational decision with game context", () => {
    expect(decideCurrencyWarGuidanceRetrieval({
      text: "# 货币战争对局\n节点：1-5 补给\n我现在应该保经济还是补战力？",
      hasCurrencyWarContext: true,
    })).toMatchObject({
      shouldRetrieve: true,
      reason: "operational-question",
    });
  });

  it("does not use general guidance for an exact entity fact question", () => {
    expect(decideCurrencyWarGuidanceRetrieval({
      text: "白厄是几费？",
      hasCurrencyWarContext: true,
    })).toEqual({
      shouldRetrieve: false,
      reason: "exact-fact-only",
    });
  });

  it("does not retrieve outside Currency War context", () => {
    expect(decideCurrencyWarGuidanceRetrieval({
      text: "请解释 TypeScript interface",
      hasCurrencyWarContext: false,
    })).toEqual({
      shouldRetrieve: false,
      reason: "not-currency-war",
    });
  });
});
