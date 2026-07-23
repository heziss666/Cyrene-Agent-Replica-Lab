import type {
  CurrencyWarCharacterInstance,
  CurrencyWarCharacterOption,
  CurrencyWarShopSlot,
} from "../../shared/currency-war-api-types.js";

export function getCharacterCosts(options: readonly CurrencyWarCharacterOption[]): number[] {
  return [...new Set(options.flatMap(({ costs }) => costs))].sort((left, right) => left - right);
}

export function getCharactersForCost(
  options: readonly CurrencyWarCharacterOption[],
  cost: number,
): CurrencyWarCharacterOption[] {
  return options.filter(({ costs }) => costs.includes(cost));
}

export function getPrimaryCost(
  options: readonly CurrencyWarCharacterOption[],
  characterName: string | null,
): number {
  return options.find(({ name }) => name === characterName)?.costs[0]
    ?? getCharacterCosts(options)[0]
    ?? 1;
}

export function createCharacterInstance(
  group: "board" | "bench",
  options: readonly CurrencyWarCharacterOption[],
  cost: number,
  idFactory: () => string = () => crypto.randomUUID(),
): CurrencyWarCharacterInstance {
  return {
    instanceId: idFactory(),
    characterName: getCharactersForCost(options, cost)[0]?.name ?? "",
    star: 1,
    position: group === "board" ? "front" : "bench",
  };
}

export function replaceCharacterForCost(
  unit: CurrencyWarCharacterInstance,
  options: readonly CurrencyWarCharacterOption[],
  cost: number,
): CurrencyWarCharacterInstance {
  const candidates = getCharactersForCost(options, cost);
  return {
    ...unit,
    characterName: candidates.some(({ name }) => name === unit.characterName)
      ? unit.characterName
      : candidates[0]?.name ?? "",
  };
}

export function numberCharacterInstances(
  board: readonly CurrencyWarCharacterInstance[],
  bench: readonly CurrencyWarCharacterInstance[],
): Array<CurrencyWarCharacterInstance & { number: number }> {
  return [...board, ...bench].map((unit, index) => ({ ...unit, number: index + 1 }));
}

export function createShopSlot(
  slot: number,
  options: readonly CurrencyWarCharacterOption[],
  cost: number,
): CurrencyWarShopSlot {
  return {
    slot,
    characterName: getCharactersForCost(options, cost)[0]?.name ?? null,
    star: 1,
  };
}
