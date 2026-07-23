import type { CurrencyWarGameState } from "../../../shared/currency-war-api-types.js";

export function createDefaultGameState(
  gameId: string,
  name = "新对局",
  now = new Date().toISOString(),
): CurrencyWarGameState {
  return {
    schemaVersion: 1,
    gameVersion: "4.4",
    gameId,
    name,
    status: "active",
    mode: "standard",
    difficulty: "highest",
    nodeId: "1-1",
    teamHealth: 100,
    gold: 0,
    level: 1,
    experience: 0,
    winStreak: null,
    board: [],
    bench: [],
    shop: { locked: false, slots: [] },
    inventory: [],
    equipmentAssignments: [],
    investmentEnvironment: null,
    investmentStrategies: [],
    advisorState: { unlocked: false, name: null },
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
}
