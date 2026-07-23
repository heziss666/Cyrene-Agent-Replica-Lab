import { describe, expect, it } from "vitest";
// @ts-expect-error The data pipeline is a Node ESM script tested directly by Vitest.
import { validateEnrichedData } from "../../scripts/currency-war-data/data-validator.mjs";

function validData() {
  return {
    characters: [{
      name: "甲",
      field: "前台",
      bonds: ["测试羁绊"],
      empowerment: {
        front: { name: "赋能", summary: "", tags: [], skills: [], shared: false },
        back: null,
        stars: { "1": { 基础前台强度: 100 } },
      },
      recommended_equipment: ["测试装备"],
    }],
    bonds: [{ name: "测试羁绊", members: ["甲"], effects: { "1": "效果" } }],
    equipment: [{ name: "测试装备", type: "进阶装备", stats: { 前台强度: "10%" }, effect: "效果" }],
    environments: [{ name: "测试环境", effect: "效果" }],
    strategies: [{ name: "测试策略", rarity: "金", effect: "效果", planes: [1] }],
  };
}

describe("validateEnrichedData", () => {
  it("accepts consistent enriched datasets", () => {
    expect(validateEnrichedData(validData()).errors).toEqual([]);
  });

  it("reports a missing reverse bond membership", () => {
    const data = validData();
    data.bonds[0]!.members = [];

    expect(validateEnrichedData(data).errors).toContain("BOND_MEMBER_MISMATCH:甲:测试羁绊");
  });

  it("reports missing empowerment for a valid field position", () => {
    const data = validData();
    data.characters[0]!.empowerment.front = null as never;

    expect(validateEnrichedData(data).errors).toContain("CHARACTER_FRONT_EMPOWERMENT_MISSING:甲");
  });

  it("reports unknown equipment references", () => {
    const data = validData();
    data.characters[0]!.recommended_equipment = ["不存在"];

    expect(validateEnrichedData(data).errors).toContain("CHARACTER_EQUIPMENT_UNKNOWN:甲:不存在");
  });
});
