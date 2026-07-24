import { beforeAll, describe, expect, it, vi } from "vitest";
import { createCurrencyWarRuntime, type CurrencyWarRuntime } from "../../../src/main/currency-war/currency-war-runtime.js";
import { loadCurrencyWarRuntime } from "../../../src/main/currency-war/data/currency-war-runtime-loader.js";
import { createCurrencyWarFactService } from "../../../src/main/currency-war/grounding/currency-war-facts.js";
import { createCurrencyWarGroundingBuilder } from "../../../src/main/currency-war/grounding/currency-war-grounding.js";

let runtime: CurrencyWarRuntime;

beforeAll(async () => {
  runtime = createCurrencyWarRuntime(await loadCurrencyWarRuntime());
});

describe("Currency War general guidance grounding", () => {
  it("adds retrieved guidance for an operational Currency War question", async () => {
    const guidance = {
      search: vi.fn(async () => ({
        mode: "keyword-fallback" as const,
        results: [{
          score: 0.9,
          chunk: {
            id: "guide_1",
            documentId: "guide",
            title: "Economy and Tempo - Stabilize",
            source: "general/economy-and-tempo.md",
            text: "When combat risk is high, compare the marginal benefit of board strength and economy.",
            index: 0,
            metadata: { sources: "official_rule:gameplay" },
          },
        }],
      })),
    };
    const builder = createCurrencyWarGroundingBuilder({
      facts: createCurrencyWarFactService(runtime),
      skills: {
        get: () => undefined,
        readBody: async () => "",
        readReference: async () => "",
      },
      guidance,
    });

    const pack = await builder.build("# 货币战争对局\n节点：1-5 补给\n我应该保经济还是补战力？");

    expect(guidance.search).toHaveBeenCalledOnce();
    expect(pack).toContain("通用攻略检索结果");
    expect(pack).toContain("Economy and Tempo - Stabilize");
    expect(pack).toContain("[通用攻略 1]");
  });
});
