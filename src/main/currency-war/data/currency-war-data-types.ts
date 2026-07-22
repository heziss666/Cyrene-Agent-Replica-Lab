export const CURRENCY_WAR_ENTITY_TYPES = [
  "characters",
  "bonds",
  "equipment",
  "investment_environments",
  "investment_strategies",
] as const;

export type CurrencyWarEntityType = (typeof CURRENCY_WAR_ENTITY_TYPES)[number];

export interface CurrencyWarEntityNames {
  zh_cn: string;
  aliases?: string[];
  [key: string]: unknown;
}

export interface CurrencyWarEntity {
  id: string;
  names: CurrencyWarEntityNames;
  bond_ids?: string[];
  member_ids?: string[];
  related_character_ids?: string[];
  related_bond_ids?: string[];
  effect?: {
    current_text?: string | null;
    status?: string;
    parse_status?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CurrencyWarRuntimeDataset {
  schemaVersion: "3.0.0";
  dataset: CurrencyWarEntityType;
  gameVersion: string;
  generatedFrom?: string;
  records: CurrencyWarEntity[];
}

export interface CurrencyWarEntityIndexEntry {
  type: CurrencyWarEntityType;
  nameZh: string;
  cost?: number;
  bonds?: string[];
}

export interface CurrencyWarEntityIndex {
  schemaVersion: "3.0.0";
  gameVersion: string;
  entities: Record<string, CurrencyWarEntityIndexEntry>;
}

export interface CurrencyWarGameRules {
  schemaVersion: "3.0.0";
  gameVersion: string;
  economy: Record<string, unknown>;
  population: Record<string, unknown>;
  shop: Record<string, unknown>;
  board: Record<string, unknown>;
  nodes: Record<string, unknown>;
}
