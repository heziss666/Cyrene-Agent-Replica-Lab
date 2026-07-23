import { describe, expect, it } from "vitest";
import type { CurrencyWarCatalog } from "../../../src/main/currency-war/data/currency-war-catalog.js";
import { createDefaultGameState } from "../../../src/main/currency-war/state/game-state-factory.js";
import { validateGameState } from "../../../src/main/currency-war/state/game-state-validator.js";

const catalog = {
  getByName: (name: string) => ["黑塔", "翡翠", "测试装备", "测试环境", "测试策略"].includes(name)
    ? ({ name } as never)
    : undefined,
  list: () => [],
  findByName: () => [],
  getRelated: () => [],
} satisfies CurrencyWarCatalog;

function validState() {
  return {
    ...createDefaultGameState("conversation-1"),
    nodeId: "2-4",
    teamHealth: 72,
    gold: 31,
    level: 2,
    board: [
      { instanceId: "unit-1", characterName: "黑塔", star: 2, position: "back" as const },
      { instanceId: "unit-2", characterName: "翡翠", star: 1, position: "front" as const },
    ],
  };
}

describe("validateGameState", () => {
  it("accepts a complete valid state and derives fixed-route facts", () => {
    expect(validateGameState(validState(), catalog)).toMatchObject({
      valid: true,
      issues: [],
      node: { type: "combat", plane: 2 },
      transition: { nextNodeId: "2-5" },
    });
  });

  it("reports stable codes and paths for unsupported mode and node", () => {
    expect(validateGameState({ ...validState(), mode: "overclock", nodeId: "2-8" }, catalog).issues)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "MODE_UNSUPPORTED", path: "mode" }),
        expect.objectContaining({ code: "NODE_UNKNOWN", path: "nodeId" }),
      ]));
  });

  it("rejects duplicate units and a board larger than the current level", () => {
    const state = validState();
    state.level = 1;
    state.bench = [{ ...state.board[0], position: "bench" }];

    expect(validateGameState(state, catalog).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "BOARD_EXCEEDS_LEVEL", path: "board" }),
      expect.objectContaining({ code: "CHARACTER_INSTANCE_DUPLICATE", path: "bench.0.instanceId" }),
    ]));
  });

  it("rejects unknown references and more than three equipment assignments", () => {
    const state = validState();
    state.inventory = [
      { instanceId: "e1", equipmentName: "测试装备" },
      { instanceId: "e2", equipmentName: "测试装备" },
      { instanceId: "e3", equipmentName: "测试装备" },
      { instanceId: "e4", equipmentName: "不存在装备" },
    ];
    state.equipmentAssignments = state.inventory.map((item) => ({
      equipmentInstanceId: item.instanceId,
      characterInstanceId: "unit-1",
    }));

    expect(validateGameState(state, catalog).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ENTITY_UNKNOWN", path: "inventory.3.equipmentName" }),
      expect.objectContaining({ code: "EQUIPMENT_LIMIT_EXCEEDED", path: "equipmentAssignments" }),
    ]));
  });

  it("rejects an investment strategy selected before its fixed-route unlock", () => {
    const state = { ...validState(), nodeId: "1-2" };
    state.investmentStrategies = [{ plane: 2, strategyName: "测试策略" }];

    expect(validateGameState(state, catalog).issues).toContainEqual(expect.objectContaining({
      code: "STRATEGY_PLANE_NOT_REACHED",
      path: "investmentStrategies.0.plane",
    }));
  });
});
