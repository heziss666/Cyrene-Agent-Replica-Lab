import type { CurrencyWarGameState } from "../../../shared/currency-war-api-types.js";

export type CurrencyWarQuestionKind = "buy" | "refresh" | "level" | "placement" | "equipment" | "strategy" | "transition";
type StateField = keyof CurrencyWarGameState;

const REQUIRED_FIELDS: Record<CurrencyWarQuestionKind, readonly StateField[]> = {
  buy: ["gold", "level", "board", "bench", "shop", "teamHealth", "nodeId"],
  refresh: ["gold", "level", "board", "bench", "shop", "teamHealth"],
  level: ["gold", "level", "experience", "board", "teamHealth", "nodeId"],
  placement: ["board", "equipmentAssignments"],
  equipment: ["board", "inventory", "equipmentAssignments"],
  strategy: ["investmentEnvironment", "investmentStrategies", "board", "gold", "teamHealth", "nodeId"],
  transition: ["board", "bench", "shop", "inventory", "equipmentAssignments", "investmentEnvironment", "investmentStrategies", "gold", "teamHealth"],
};

export function getMissingGameStateFields(
  question: CurrencyWarQuestionKind,
  state: Partial<CurrencyWarGameState>,
): StateField[] {
  return REQUIRED_FIELDS[question].filter((field) => state[field] === undefined || state[field] === null);
}
