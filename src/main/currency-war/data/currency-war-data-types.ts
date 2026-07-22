export const CURRENCY_WAR_ENTITY_TYPES = [
  "characters",
  "bonds",
  "equipment",
  "investment_environments",
  "investment_strategies",
] as const;

export type CurrencyWarEntityType = (typeof CURRENCY_WAR_ENTITY_TYPES)[number];

export interface CurrencyWarSource {
  name: string;
  url: string;
  updated_at: string;
}

export interface CurrencyWarNamedEntity {
  name: string;
  aliases?: string[];
  [key: string]: unknown;
}

export interface CurrencyWarCharacter extends CurrencyWarNamedEntity {
  cost: number | number[];
  field: string;
  roles: string[];
  bonds: string[];
  empowerment: { front: unknown; back: unknown; stars: Record<string, unknown> };
  advisor: boolean | Record<string, unknown> | null;
}

export interface CurrencyWarBond extends CurrencyWarNamedEntity {
  category: string;
  members: string[];
  effects: Record<string, unknown>;
}

export interface CurrencyWarEquipment extends CurrencyWarNamedEntity {
  type: string;
  stats: Record<string, unknown>;
  effect: string | null;
  recipe?: string[];
}

export interface CurrencyWarInvestmentStrategy extends CurrencyWarNamedEntity {
  rarity: string;
  effect: string;
  planes: number[];
}

export interface CurrencyWarInvestmentEnvironment extends CurrencyWarNamedEntity {
  effect: string | null;
}

export type CurrencyWarCatalogEntity = CurrencyWarCharacter
  | CurrencyWarBond
  | CurrencyWarEquipment
  | CurrencyWarInvestmentStrategy
  | CurrencyWarInvestmentEnvironment;
