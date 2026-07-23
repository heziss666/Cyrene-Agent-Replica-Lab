import { describe, expect, it } from "vitest";
import { createDefaultGameState } from "../../../src/main/currency-war/state/game-state-factory.js";
import { buildCurrencyWarGameSummary } from "../../../src/main/currency-war/games/currency-war-game-summary.js";

describe("buildCurrencyWarGameSummary", () => {
  it("includes selected character costs and equipment quantities", () => {
    const state = createDefaultGameState("game-1", "银狼测试");
    state.board = [{
      instanceId: "unit-1",
      characterName: "银狼LV.999",
      cost: 5,
      star: 2,
      position: "front",
    }];
    state.inventory = [{ instanceId: "equipment-1", equipmentName: "测试装备", quantity: 2 }];
    state.equipmentAssignments = [{
      equipmentInstanceId: "equipment-1",
      characterInstanceId: "unit-1",
      quantity: 1,
    }];

    const summary = buildCurrencyWarGameSummary(state);
    expect(summary).toContain("1号 银狼LV.999（5费，2星，前台）");
    expect(summary).toContain("测试装备 × 2");
    expect(summary).toContain("1号 银狼LV.999：测试装备 × 1");
  });
});
