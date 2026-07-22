export type CurrencyWarMode = "standard" | "overclock";
export type CurrencyWarDifficulty = "highest" | "other";
export type BoardPosition = "front" | "back";

export interface CurrencyWarUnitState {
  name: string;
  star: number;
  position?: BoardPosition;
}

export interface CurrencyWarGameState {
  mode: CurrencyWarMode;
  difficulty: CurrencyWarDifficulty;
  nodeId: string;
  teamHealth: number;
  gold: number;
  level: number;
  experience: number;
  board: CurrencyWarUnitState[];
  bench: CurrencyWarUnitState[];
  shop: string[];
  equipment: string[];
  investmentEnvironment: string | null;
  investmentStrategies: string[];
  advisorUnlocked: boolean;
}

export interface CurrencyWarGameStateInput extends Omit<CurrencyWarGameState, "mode" | "difficulty"> {
  mode: string;
  difficulty: string;
}
