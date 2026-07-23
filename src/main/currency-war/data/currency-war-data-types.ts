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
  empowerment: {
    front: CurrencyWarEmpowermentGroup | null;
    back: CurrencyWarEmpowermentGroup | null;
    stars: Record<string, Record<string, string | number>>;
  };
  recommended_equipment?: string[];
  advisor: boolean | Record<string, unknown> | null;
}

export interface CurrencyWarEmpowermentSkill {
  name: string;
  tags: string[];
  description: string;
}

export interface CurrencyWarEmpowermentGroup {
  name: string;
  summary: string;
  tags: string[];
  skills: CurrencyWarEmpowermentSkill[];
  shared: boolean;
}

export interface CurrencyWarBond extends CurrencyWarNamedEntity {
  category: string;
  members: string[];
  effects: Record<string, unknown>;
  base_effect?: string;
  special_rules?: string[];
}

export interface CurrencyWarEquipment extends CurrencyWarNamedEntity {
  type: string;
  stats: Record<string, unknown>;
  effect: string | null;
  recipe?: string[];
  tags?: string[];
  recommended_for?: string[];
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
