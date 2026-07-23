export type CurrencyWarGameStatus = "active" | "won" | "lost";
export type CurrencyWarPosition = "front" | "back" | "bench";

export interface CurrencyWarCharacterInstance {
  instanceId: string;
  characterName: string;
  star: number;
  position: CurrencyWarPosition;
}

export interface CurrencyWarShopSlot {
  slot: number;
  characterName: string | null;
  star: number;
}

export interface CurrencyWarShopState {
  locked: boolean;
  slots: CurrencyWarShopSlot[];
}

export interface CurrencyWarInventoryItem {
  instanceId: string;
  equipmentName: string;
}

export interface CurrencyWarEquipmentAssignment {
  equipmentInstanceId: string;
  characterInstanceId: string;
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
  conversationId: string;
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
  specialResources: Record<string, number>;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

type ImmutableStateKeys =
  | "schemaVersion"
  | "gameVersion"
  | "conversationId"
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

export interface CurrencyWarStateApi {
  get(conversationId: string): Promise<CurrencyWarGameState>;
  create(conversationId: string): Promise<CurrencyWarGameState>;
  update(conversationId: string, patch: CurrencyWarStatePatch): Promise<CurrencyWarStateUpdateResult>;
  reset(conversationId: string): Promise<CurrencyWarGameState>;
  validate(conversationId: string): Promise<CurrencyWarStateValidationResult>;
  getEditorOptions(): Promise<CurrencyWarEditorOptions>;
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
