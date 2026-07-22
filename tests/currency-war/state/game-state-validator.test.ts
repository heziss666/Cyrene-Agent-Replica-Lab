import { describe, expect, it } from "vitest";
import { validateGameState } from "../../../src/main/currency-war/state/game-state-validator.js";

const validState = {
  mode: "standard",
  difficulty: "highest",
  nodeId: "2-4",
  teamHealth: 72,
  gold: 31,
  level: 7,
  experience: 12,
  board: [],
  bench: [],
  shop: [],
  equipment: [],
  investmentEnvironment: null,
  investmentStrategies: [],
  advisorUnlocked: false,
};

describe("validateGameState", () => {
  it("accepts standard highest-difficulty input and derives node facts", () => {
    expect(validateGameState(validState)).toMatchObject({
      valid: true,
      node: { type: "combat", plane: 2 },
      transition: { nextNodeId: "2-5" },
    });
  });

  it("rejects non-standard modes and non-highest difficulties", () => {
    expect(validateGameState({ ...validState, mode: "overclock" })).toMatchObject({ valid: false, issues: ["MODE_UNSUPPORTED"] });
    expect(validateGameState({ ...validState, difficulty: "normal" })).toMatchObject({ valid: false, issues: ["DIFFICULTY_UNSUPPORTED"] });
  });

  it("rejects an invalid node on the fixed route", () => {
    expect(validateGameState({ ...validState, nodeId: "2-8" })).toMatchObject({ valid: false, issues: ["NODE_UNKNOWN"] });
  });
});
