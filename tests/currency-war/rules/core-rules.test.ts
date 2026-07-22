import { describe, expect, it } from "vitest";
import { calculateStandardInterest } from "../../../src/main/currency-war/rules/interest-calculator.js";
import { getShopOdds } from "../../../src/main/currency-war/rules/shop-odds.js";
import { analyzeStarUp } from "../../../src/main/currency-war/rules/star-up.js";
import { validatePlacement } from "../../../src/main/currency-war/rules/placement-validator.js";
import { validateEquipmentAssignments } from "../../../src/main/currency-war/rules/equipment-validator.js";
import { calculateStandardRatingPromotion } from "../../../src/main/currency-war/rules/rating-calculator.js";
import { analyzeBonds } from "../../../src/main/currency-war/rules/bond-analyzer.js";

describe("core standard rules", () => {
  it("calculates capped standard-mode interest", () => {
    expect(calculateStandardInterest(49)).toBe(4);
    expect(calculateStandardInterest(65)).toBe(5);
  });

  it("returns the documented shop odds by level", () => {
    expect(getShopOdds(8)).toEqual({ 1: 18, 2: 25, 3: 32, 4: 22, 5: 3 });
  });

  it("reports the copies still needed for a three-copy star-up", () => {
    expect(analyzeStarUp([
      { name: "测试角色", star: 1 },
      { name: "测试角色", star: 1 },
    ])).toEqual([{ name: "测试角色", star: 1, copies: 2, copiesNeeded: 1 }]);
  });

  it("flags a front-only character placed on the back row", () => {
    expect(validatePlacement([
      { name: "测试角色", field: "前台", position: "back" },
    ])).toEqual([{ name: "测试角色", issue: "POSITION_MISMATCH" }]);
  });

  it("rejects more than three equipment assignments for one character", () => {
    expect(validateEquipmentAssignments([
      { equipment: "A", character: "测试角色" },
      { equipment: "B", character: "测试角色" },
      { equipment: "C", character: "测试角色" },
      { equipment: "D", character: "测试角色" },
    ])).toEqual([{ character: "测试角色", issue: "EQUIPMENT_LIMIT_EXCEEDED" }]);
  });

  it("maps remaining team health to standard-mode promotion", () => {
    expect(calculateStandardRatingPromotion(70)).toBe(3);
    expect(calculateStandardRatingPromotion(40)).toBe(2);
    expect(calculateStandardRatingPromotion(39)).toBe(1);
  });

  it("counts active bond members and the gap to the next tier", () => {
    const characters = [
      { name: "甲", bonds: ["测试羁绊"] },
      { name: "乙", bonds: ["测试羁绊"] },
    ] as never[];
    const bonds = [{ name: "测试羁绊", members: ["甲", "乙"], effects: { 1: "x", 2: "y", 3: "z" } }] as never[];

    expect(analyzeBonds(["甲", "乙"], characters, bonds)).toEqual([{
      name: "测试羁绊", activeMembers: 2, activeTiers: [1, 2], nextTier: 3, membersNeeded: 1,
    }]);
  });
});
