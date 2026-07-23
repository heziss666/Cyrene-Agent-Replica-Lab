import type {
  CurrencyWarCharacterInstance,
  CurrencyWarGameState,
  CurrencyWarInventoryItem,
} from "../../../shared/currency-war-api-types.js";
import { createDefaultGameState } from "./game-state-factory.js";

export function migrateGameState(
  input: unknown,
  gameId: string,
  now = new Date().toISOString(),
): CurrencyWarGameState {
  if (!isRecord(input)) throw new Error("GAME_STATE_INVALID");
  if (input.schemaVersion === 1) {
    const cloned = structuredClone(input) as unknown as CurrencyWarGameState;
    cloned.shop.slots = cloned.shop.slots.map((slot) => ({
      ...slot,
      cost: Number.isInteger(slot.cost) && slot.cost > 0 ? slot.cost : 1,
      star: Number.isInteger(slot.star) && slot.star > 0 ? slot.star : 1,
    }));
    return cloned;
  }
  if (input.schemaVersion !== undefined) {
    throw new Error("GAME_STATE_SCHEMA_UNSUPPORTED");
  }

  const base = createDefaultGameState(gameId, "旧对局", now);
  const board = migrateUnits(input.board, "board");
  const bench = migrateUnits(input.bench, "bench");
  const shopNames = stringArray(input.shop);
  const equipmentNames = stringArray(input.equipment);

  return {
    ...base,
    status: oneOf(input.status, ["active", "won", "lost"]) ?? base.status,
    nodeId: stringValue(input.nodeId) ?? base.nodeId,
    teamHealth: numberValue(input.teamHealth) ?? base.teamHealth,
    gold: numberValue(input.gold) ?? base.gold,
    level: numberValue(input.level) ?? base.level,
    experience: numberValue(input.experience) ?? base.experience,
    board,
    bench,
    shop: {
      locked: false,
      slots: shopNames.map((characterName, index) => ({ slot: index + 1, characterName, cost: 1, star: 1 })),
    },
    inventory: equipmentNames.map((equipmentName, index): CurrencyWarInventoryItem => ({
      instanceId: `legacy-equipment-${index + 1}`,
      equipmentName,
      quantity: 1,
    })),
    investmentEnvironment: stringValue(input.investmentEnvironment),
    investmentStrategies: stringArray(input.investmentStrategies).map((strategyName, index) => ({
      plane: Math.min(index + 1, 3) as 1 | 2 | 3,
      strategyName,
    })),
    advisorState: {
      unlocked: input.advisorUnlocked === true,
      name: null,
    },
  };
}

function migrateUnits(value: unknown, fallbackPosition: "board" | "bench"): CurrencyWarCharacterInstance[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const characterName = stringValue(item.characterName) ?? stringValue(item.name);
    if (!characterName) return [];
    const position = fallbackPosition === "bench"
      ? "bench"
      : oneOf(item.position, ["front", "back"]) ?? "front";
    return [{
      instanceId: stringValue(item.instanceId) ?? `legacy-${fallbackPosition}-${index + 1}`,
      characterName,
      cost: numberValue(item.cost) ?? 1,
      star: numberValue(item.star) ?? 1,
      position,
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function oneOf<T extends string>(value: unknown, choices: readonly T[]): T | undefined {
  return typeof value === "string" && choices.includes(value as T) ? value as T : undefined;
}
