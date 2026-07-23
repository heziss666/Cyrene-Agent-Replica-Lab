import { describe, expect, it } from "vitest";
// @ts-expect-error The data pipeline is a Node ESM script tested directly by Vitest.
import { buildEnrichedDatasets } from "../../scripts/currency-war-data/enrichment-pipeline.mjs";

describe("buildEnrichedDatasets", () => {
  it("merges parsed details while preserving aliases and assigning bond members", () => {
    const existing = {
      characters: [{
        name: "甲",
        aliases: ["小甲"],
        cost: 1,
        field: "前台",
        roles: [],
        bonds: ["测试羁绊"],
        empowerment: { front: null, back: null, stars: {} },
        advisor: null,
      }],
      bonds: [{ name: "测试羁绊", category: "流派", members: [], effects: {} }],
      equipment: [{ name: "测试装备", type: "进阶装备", stats: {}, effect: null }],
      environments: [{ name: "测试环境", effect: null }],
      strategies: [{ name: "测试策略", rarity: "金", effect: "效果", planes: [1] }],
    };
    const characterDetails = new Map([["甲", {
      name: "甲",
      aliases: [],
      cost: 1,
      field: "前台",
      roles: ["输出"],
      bonds: ["测试羁绊"],
      empowerment: {
        front: { name: "赋能", summary: "", tags: [], skills: [], shared: false },
        back: null,
        stars: { "1": { 基础前台强度: 100 } },
      },
      recommended_equipment: ["测试装备"],
    }]]);

    const result = buildEnrichedDatasets({
      existing,
      characterDetails,
      bondDetails: new Map([["测试羁绊", {
        name: "测试羁绊",
        category: "流派",
        members: [],
        base_effect: "基础",
        effects: { "1": "效果" },
        special_rules: [],
      }]]),
      equipmentDetails: new Map([["测试装备", {
        name: "测试装备",
        type: "进阶装备",
        tags: [],
        stats: { 前台强度: "10%" },
        effect: "装备效果",
        recommended_for: ["甲"],
      }]]),
      environmentDetails: new Map([["测试环境", { name: "测试环境", effect: "环境效果" }]]),
      advisors: new Set(["甲"]),
    });

    expect(result.characters[0]).toMatchObject({ aliases: ["小甲"], advisor: true });
    expect(result.bonds[0]!.members).toEqual(["甲"]);
    expect(result.equipment[0]!.stats).toEqual({ 前台强度: "10%" });
    expect(result.environments[0]!.effect).toBe("环境效果");
  });

  it("refuses an incomplete source snapshot", () => {
    expect(() => buildEnrichedDatasets({
      existing: {
        characters: [{ name: "甲" }],
        bonds: [],
        equipment: [],
        environments: [],
        strategies: [],
      },
      characterDetails: new Map(),
      bondDetails: new Map(),
      equipmentDetails: new Map(),
      environmentDetails: new Map(),
      advisors: new Set(),
    })).toThrow("CURRENCY_WAR_ENRICHMENT_CHARACTER_MISSING:甲");
  });
});
