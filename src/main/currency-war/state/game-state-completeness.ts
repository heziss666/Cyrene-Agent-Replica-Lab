import type { CurrencyWarGameStateInput } from "./game-state-types.js";

export type CurrencyWarQuestionKind = "buy" | "refresh" | "level" | "placement" | "equipment" | "strategy" | "transition";
type StateField = keyof CurrencyWarGameStateInput;

const REQUIRED_FIELDS: Record<CurrencyWarQuestionKind, readonly StateField[]> = {
  buy: ["gold", "level", "board", "bench", "shop", "teamHealth", "nodeId"],
  refresh: ["gold", "level", "board", "bench", "shop", "teamHealth"],
  level: ["gold", "level", "experience", "board", "teamHealth", "nodeId"],
  placement: ["board", "equipment"],
  equipment: ["board", "equipment"],
  strategy: ["investmentEnvironment", "investmentStrategies", "board", "gold", "teamHealth", "nodeId"],
  transition: ["board", "bench", "shop", "equipment", "investmentEnvironment", "investmentStrategies", "gold", "teamHealth"],
};

export function getMissingGameStateFields(
  question: CurrencyWarQuestionKind,
  state: Partial<CurrencyWarGameStateInput>,
): StateField[] {
  return REQUIRED_FIELDS[question].filter((field) => state[field] === undefined || state[field] === null);
}
