import { getStandardNode, getStandardTransition, type StandardNode } from "../rules/standard-node-sequence.js";
import type { CurrencyWarGameStateInput } from "./game-state-types.js";

export type GameStateValidationIssue = "MODE_UNSUPPORTED" | "DIFFICULTY_UNSUPPORTED" | "NODE_UNKNOWN" | "VALUE_INVALID";
export type GameStateValidationResult =
  | { valid: true; node: StandardNode; transition: ReturnType<typeof getStandardTransition> }
  | { valid: false; issues: GameStateValidationIssue[] };

export function validateGameState(state: CurrencyWarGameStateInput): GameStateValidationResult {
  const issues: GameStateValidationIssue[] = [];
  if (state.mode !== "standard") issues.push("MODE_UNSUPPORTED");
  if (state.difficulty !== "highest") issues.push("DIFFICULTY_UNSUPPORTED");
  if (!isNonNegativeInteger(state.teamHealth) || !isNonNegativeInteger(state.gold) || !isNonNegativeInteger(state.level) || !isNonNegativeInteger(state.experience)) {
    issues.push("VALUE_INVALID");
  }
  if (issues.length > 0) return { valid: false, issues };
  try {
    const node = getStandardNode(state.nodeId);
    return { valid: true, node, transition: getStandardTransition(state.nodeId) };
  } catch {
    return { valid: false, issues: ["NODE_UNKNOWN"] };
  }
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}
