import { describe, expect, it } from "vitest";
import type { CurrencyWarCharacterOption } from "../../src/shared/currency-war-api-types.js";
import {
  createCharacterInstance,
  createShopSlot,
  getCharactersForCost,
  numberCharacterInstances,
  replaceCharacterForCost,
} from "../../src/renderer/chat/currency-war-character-editor.js";

const options: CurrencyWarCharacterOption[] = [
  { name: "一费角色", costs: [1], advisor: false },
  { name: "多费角色", costs: [2, 3], advisor: true },
  { name: "二费角色", costs: [2], advisor: false },
];

describe("currency war character editor", () => {
  it("filters characters by cost", () => {
    expect(getCharactersForCost(options, 2).map(({ name }) => name))
      .toEqual(["多费角色", "二费角色"]);
  });

  it("creates stable instances and replaces an incompatible character after cost changes", () => {
    const unit = createCharacterInstance("board", options, 1, () => "unit-1");
    expect(unit).toEqual({
      instanceId: "unit-1",
      characterName: "一费角色",
      cost: 1,
      star: 1,
      position: "front",
    });
    expect(replaceCharacterForCost(unit, options, 2)).toMatchObject({
      instanceId: "unit-1",
      characterName: "多费角色",
      star: 1,
    });
  });

  it("numbers board before bench without changing instance ids", () => {
    expect(numberCharacterInstances(
      [{ instanceId: "board-a", characterName: "A", cost: 1, star: 2, position: "front" }],
      [{ instanceId: "bench-a", characterName: "B", cost: 1, star: 1, position: "bench" }],
    ).map(({ number, instanceId }) => ({ number, instanceId }))).toEqual([
      { number: 1, instanceId: "board-a" },
      { number: 2, instanceId: "bench-a" },
    ]);
  });

  it("creates a shop slot with character and star", () => {
    expect(createShopSlot(3, options, 2)).toEqual({
      slot: 3,
      characterName: "多费角色",
      cost: 2,
      star: 1,
    });
  });
});
