import { describe, expect, it } from "vitest";
import { getMissingGameStateFields } from "../../../src/main/currency-war/state/game-state-completeness.js";

describe("getMissingGameStateFields", () => {
  it("asks only for key inputs needed before recommending a shop refresh", () => {
    expect(getMissingGameStateFields("refresh", {
      nodeId: "2-4",
      gold: 20,
      level: 7,
    })).toEqual(["board", "bench", "shop", "teamHealth"]);
  });

  it("uses inventory and assignments for an equipment question", () => {
    expect(getMissingGameStateFields("equipment", {
      board: [],
      inventory: [],
      equipmentAssignments: [],
    })).toEqual([]);
  });
});
