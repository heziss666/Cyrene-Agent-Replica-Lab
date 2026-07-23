export type CurrencyWarGameStatus = "active" | "won" | "lost";
export type CurrencyWarPosition = "front" | "back" | "bench";

export interface CurrencyWarCharacterInstance {
  instanceId: string;
  characterName: string;
  cost: number;
  star: number;
  position: CurrencyWarPosition;
}

export interface CurrencyWarShopSlot {
  slot: number;
  characterName: string | null;
  cost: number;
  star: number;
}

export interface CurrencyWarShopState {
  locked: boolean;
  slots: CurrencyWarShopSlot[];
}

export interface CurrencyWarInventoryItem {
  instanceId: string;
  equipmentName: string;
  quantity: number;
}

export interface CurrencyWarEquipmentAssignment {
  equipmentInstanceId: string;
  characterInstanceId: string;
  quantity: number;
}

export interface CurrencyWarInvestmentStrategySelection {
  plane: 1 | 2 | 3;
  strategyName: string;
}

export interface CurrencyWarAdvisorState {
  unlocked: boolean;
  name: string | null;
}

export interface CurrencyWarGameState {
  schemaVersion: 1;
  gameVersion: "4.4";
  gameId: string;
  name: string;
  status: CurrencyWarGameStatus;
  mode: "standard";
  difficulty: "highest";
  nodeId: string;
  teamHealth: number;
  gold: number;
  level: number;
  experience: number;
  winStreak: number | null;
  board: CurrencyWarCharacterInstance[];
  bench: CurrencyWarCharacterInstance[];
  shop: CurrencyWarShopState;
  inventory: CurrencyWarInventoryItem[];
  equipmentAssignments: CurrencyWarEquipmentAssignment[];
  investmentEnvironment: string | null;
  investmentStrategies: CurrencyWarInvestmentStrategySelection[];
  advisorState: CurrencyWarAdvisorState;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

type ImmutableStateKeys =
  | "schemaVersion"
  | "gameVersion"
  | "gameId"
  | "mode"
  | "difficulty"
  | "createdAt"
  | "updatedAt";

export type CurrencyWarStatePatch = Partial<Omit<CurrencyWarGameState, ImmutableStateKeys>>;

export interface CurrencyWarValidationIssue {
  code: string;
  path: string;
  severity: "error" | "warning";
  message: string;
}

export interface CurrencyWarStateValidationResult {
  valid: boolean;
  issues: CurrencyWarValidationIssue[];
}

export interface CurrencyWarStateUpdateResult extends CurrencyWarStateValidationResult {
  state: CurrencyWarGameState;
  saved: boolean;
}

export interface CurrencyWarGamesApi {
  list(): Promise<CurrencyWarGameListResult>;
  get(gameId: string): Promise<CurrencyWarGameState>;
  create(name?: string): Promise<CurrencyWarGameState>;
  setActive(gameId: string): Promise<CurrencyWarGameState>;
  rename(gameId: string, name: string): Promise<CurrencyWarGameState>;
  update(gameId: string, patch: CurrencyWarStatePatch): Promise<CurrencyWarStateUpdateResult>;
  reset(gameId: string): Promise<CurrencyWarGameState>;
  remove(gameId: string): Promise<CurrencyWarGameListResult>;
  validate(gameId: string): Promise<CurrencyWarStateValidationResult>;
  getEditorOptions(): Promise<CurrencyWarEditorOptions>;
  summarize(gameId: string): Promise<string>;
}

export interface CurrencyWarCharacterOption {
  name: string;
  costs: number[];
  advisor: boolean;
}

export interface CurrencyWarEditorOptions {
  characters: CurrencyWarCharacterOption[];
  equipment: string[];
}

export interface CurrencyWarGameIndexEntry {
  gameId: string;
  name: string;
  nodeId: string;
  status: CurrencyWarGameStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CurrencyWarGameListResult {
  activeGameId: string;
  games: CurrencyWarGameIndexEntry[];
  maxGames: number;
}
