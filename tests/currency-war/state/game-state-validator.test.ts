import { describe, expect, it } from "vitest";
import type { CurrencyWarCatalog } from "../../../src/main/currency-war/data/currency-war-catalog.js";
import { createDefaultGameState } from "../../../src/main/currency-war/state/game-state-factory.js";
import { validateGameState } from "../../../src/main/currency-war/state/game-state-validator.js";

const entities = [
  { name: "黑塔", cost: 4 },
  { name: "银狼LV.999", cost: [3, 4, 5] },
  { name: "翡翠", cost: 5 },
  { name: "测试装备" },
  { name: "测试环境" },
  { name: "测试策略" },
] as const;

const catalog = {
  getByName: (name: string) => entities.find((entity) => entity.name === name) as never,
  list: () => [],
  findByName: () => [],
  getRelated: () => [],
} satisfies CurrencyWarCatalog;

function validState() {
  return {
    ...createDefaultGameState("game-1", "测试对局"),
    nodeId: "2-4",
    teamHealth: 72,
    gold: 31,
    level: 2,
    board: [
      { instanceId: "unit-1", characterName: "黑塔", cost: 4, star: 2, position: "back" as const },
      { instanceId: "unit-2", characterName: "翡翠", cost: 5, star: 1, position: "front" as const },
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

  it("allows a board larger than the current level but still rejects duplicate units", () => {
    const state = validState();
    state.level = 1;
    state.bench = [{ ...state.board[0], position: "bench" }];

    expect(validateGameState(state, catalog).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "CHARACTER_INSTANCE_DUPLICATE", path: "bench.0.instanceId" }),
    ]));
    expect(validateGameState(state, catalog).issues)
      .not.toContainEqual(expect.objectContaining({ code: "BOARD_EXCEEDS_LEVEL" }));
  });

  it("accepts all three Silver Wolf costs and rejects a cost outside a character catalog entry", () => {
    for (const cost of [3, 4, 5]) {
      const state = validState();
      state.board[0] = {
        instanceId: "unit-1",
        characterName: "银狼LV.999",
        cost,
        star: 2,
        position: "back",
      };
      expect(validateGameState(state, catalog).issues)
        .not.toContainEqual(expect.objectContaining({ code: "CHARACTER_COST_INVALID" }));
    }

    const invalid = validState();
    invalid.board[0].cost = 5;
    expect(validateGameState(invalid, catalog).issues).toContainEqual(expect.objectContaining({
      code: "CHARACTER_COST_INVALID",
      path: "board.0.cost",
    }));
  });

  it("rejects three-star shop characters", () => {
    const state = validState();
    state.shop.slots = [{ slot: 1, characterName: "黑塔", cost: 4, star: 3 }];

    expect(validateGameState(state, catalog).issues).toContainEqual(expect.objectContaining({
      code: "SHOP_STAR_INVALID",
      path: "shop.slots.0.star",
    }));
  });

  it("rejects unknown references, insufficient inventory, and more than three assigned items", () => {
    const state = validState();
    state.inventory = [
      { instanceId: "e1", equipmentName: "测试装备", quantity: 2 },
      { instanceId: "e2", equipmentName: "不存在装备", quantity: 2 },
    ];
    state.equipmentAssignments = [
      {
        equipmentInstanceId: "e1",
        characterInstanceId: "unit-1",
        quantity: 3,
      },
      {
        equipmentInstanceId: "e2",
        characterInstanceId: "unit-1",
        quantity: 1,
      },
    ];

    expect(validateGameState(state, catalog).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ENTITY_UNKNOWN", path: "inventory.1.equipmentName" }),
      expect.objectContaining({ code: "EQUIPMENT_QUANTITY_EXCEEDED", path: "equipmentAssignments" }),
      expect.objectContaining({ code: "EQUIPMENT_LIMIT_EXCEEDED", path: "equipmentAssignments" }),
    ]));
  });

  it("allows splitting one inventory stack across characters within its quantity", () => {
    const state = validState();
    state.inventory = [{ instanceId: "e1", equipmentName: "测试装备", quantity: 2 }];
    state.equipmentAssignments = state.board.map((character) => ({
      equipmentInstanceId: "e1",
      characterInstanceId: "unit-1",
      quantity: 1,
    }));

    state.equipmentAssignments[1].characterInstanceId = "unit-2";
    expect(validateGameState(state, catalog).issues)
      .not.toContainEqual(expect.objectContaining({ code: "EQUIPMENT_ASSIGNED_TWICE" }));
    expect(validateGameState(state, catalog).issues)
      .not.toContainEqual(expect.objectContaining({ code: "EQUIPMENT_QUANTITY_EXCEEDED" }));
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
