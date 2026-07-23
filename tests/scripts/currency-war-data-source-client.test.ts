import { describe, expect, it } from "vitest";
// @ts-expect-error The data pipeline is a Node ESM script tested directly by Vitest.
import { askSemantic, fetchPageRevisions } from "../../scripts/currency-war-data/mediawiki-client.mjs";
// @ts-expect-error The data pipeline is a Node ESM script tested directly by Vitest.
import { parseEnvironmentResult, parseEquipmentResult } from "../../scripts/currency-war-data/semantic-record-parser.mjs";

describe("currency war source client", () => {
  it("returns revision content keyed by requested title", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      query: {
        pages: [{
          title: "货币战争/白厄",
          revisions: [{ revid: 12, timestamp: "2026-07-24T00:00:00Z", slots: { main: { content: "PAGE" } } }],
        }],
      },
    }), { status: 200 });

    const result = await fetchPageRevisions(["货币战争/白厄"], { fetchImpl, delayMs: 0 });

    expect(result.get("货币战争/白厄")).toMatchObject({ revisionId: 12, content: "PAGE" });
  });

  it("retries a temporary 567 response", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return calls === 1
        ? new Response("limited", { status: 567 })
        : new Response(JSON.stringify({ query: { results: {} } }), { status: 200 });
    };

    await expect(askSemantic("[[分类:投资环境]]", {
      fetchImpl,
      delayMs: 0,
      retryDelayMs: 0,
      maxAttempts: 2,
    })).resolves.toEqual({});
    expect(calls).toBe(2);
  });

  it("normalizes equipment semantic fields", () => {
    const result = parseEquipmentResult({
      printouts: {
        名称: ["以牙还牙甲"],
        类型: ["进阶装备"],
        标签: ["护盾", "反伤"],
        基础属性: ["幸运一击率20%", "伤害减免10%", "护盾强度20%"],
        描述: ["战斗开始时获得护盾。"],
        获取途径: ["幸运星+量产型装甲"],
        适配角色: ["砂金", "白厄"],
      },
    });

    expect(result).toEqual({
      name: "以牙还牙甲",
      type: "进阶装备",
      tags: ["护盾", "反伤"],
      stats: { 幸运一击率: "20%", 伤害减免: "10%", 护盾强度: "20%" },
      effect: "战斗开始时获得护盾。",
      recipe: ["幸运星", "量产型装甲"],
      recommended_for: ["砂金", "白厄"],
    });
  });

  it("normalizes environment semantic fields", () => {
    expect(parseEnvironmentResult({
      printouts: { 名称: ["长线利好"], 效果: ["刷新30次后获得20金币。"] },
    })).toEqual({ name: "长线利好", effect: "刷新30次后获得20金币。" });
  });
});
