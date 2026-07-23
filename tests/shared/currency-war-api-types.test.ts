import { describe, expect, it } from "vitest";
import type {
  CurrencyWarGameState,
  CurrencyWarStatePatch,
} from "../../src/shared/currency-war-api-types.js";

describe("currency war shared types", () => {
  it("represents a complete serializable game state and editable patch", () => {
    const state: CurrencyWarGameState = {
      schemaVersion: 1,
      gameVersion: "4.4",
      conversationId: "conversation-1",
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
      specialResources: {},
      notes: "",
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:00:00.000Z",
    };
    const patch: CurrencyWarStatePatch = { gold: 12, notes: "test" };

    expect({ ...state, ...patch }).toMatchObject({ gold: 12, notes: "test" });
  });
});
