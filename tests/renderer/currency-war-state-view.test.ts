import { describe, expect, it } from "vitest";
import {
  parseCharacterLines,
  parseShopNames,
} from "../../src/renderer/chat/currency-war-state-view.js";

describe("currency war state text editors", () => {
  it("parses lightweight character rows into strict instances", () => {
    expect(parseCharacterLines("黑塔 | 2 | back\n翡翠 | 1 | front", "board")).toEqual([
      { instanceId: "board-1", characterName: "黑塔", star: 2, position: "back" },
      { instanceId: "board-2", characterName: "翡翠", star: 1, position: "front" },
    ]);
  });

  it("parses comma-separated shop names and preserves empty slots", () => {
    expect(parseShopNames("黑塔, ,翡翠")).toEqual([
      { slot: 1, characterName: "黑塔" },
      { slot: 2, characterName: null },
      { slot: 3, characterName: "翡翠" },
    ]);
  });
});
