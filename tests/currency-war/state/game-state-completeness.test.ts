import { describe, expect, it } from "vitest";
import { getMissingGameStateFields } from "../../../src/main/currency-war/state/game-state-completeness.js";

describe("getMissingGameStateFields", () => {
  it("asks only for the key inputs needed before recommending a shop refresh", () => {
    expect(getMissingGameStateFields("refresh", {
      mode: "standard",
      difficulty: "highest",
      nodeId: "2-4",
      gold: 20,
      level: 7,
    })).toEqual(["board", "bench", "shop", "teamHealth"]);
  });

  it("does not ask for an investment environment when answering a placement question", () => {
    expect(getMissingGameStateFields("placement", {
      board: [],
      equipment: [],
    })).toEqual([]);
  });
});
