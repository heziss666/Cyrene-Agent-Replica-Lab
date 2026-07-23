import { describe, expect, it } from "vitest";
import { routeCurrencyWarSkills } from "../../../src/main/currency-war/grounding/currency-war-skill-router.js";

describe("routeCurrencyWarSkills", () => {
  it.each([
    ["我想玩白厄反伤流", "currency-war-phainon-counter-armor"],
    ["以牙还牙甲现在能不能合", "currency-war-phainon-counter-armor"],
    ["卡芙卡和海瑟音怎么运营", "currency-war-kafka-hysilens-dot"],
    ["这把持续伤害阵容怎么过渡", "currency-war-kafka-hysilens-dot"],
    ["姬子·启行什么时候发车", "currency-war-himeko-departure-train"],
    ["列车体系现在应该升级吗", "currency-war-himeko-departure-train"],
  ])("routes %s to %s", (text, expected) => {
    expect(routeCurrencyWarSkills(text)).toEqual([expected]);
  });

  it("returns no lineup skill for an unrelated question", () => {
    expect(routeCurrencyWarSkills("现在几点")).toEqual([]);
  });

  it("caps explicit lineup comparisons at two skills", () => {
    expect(routeCurrencyWarSkills("白厄反甲、卡芙卡持续伤害和姬子发车哪个更好"))
      .toHaveLength(2);
  });
});
