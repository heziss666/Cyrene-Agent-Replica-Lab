import { z } from "zod";
import type {
  CurrencyWarBond,
  CurrencyWarCharacter,
  CurrencyWarEquipment,
  CurrencyWarInvestmentEnvironment,
  CurrencyWarInvestmentStrategy,
  CurrencyWarSource,
} from "./currency-war-data-types.js";

export type CurrencyWarSimpleDataset = "characters" | "bonds" | "equipment" | "investment_environments" | "investment_strategies";

const sourceSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  updated_at: z.string().min(1),
}).passthrough();
const baseDocumentSchema = z.object({ version: z.string().min(1), source: sourceSchema }).passthrough();
const namedEntitySchema = z.object({ name: z.string().min(1), aliases: z.array(z.string()).optional() }).passthrough();
const empowermentSkillSchema = z.object({
  name: z.string().min(1),
  tags: z.array(z.string()),
  description: z.string(),
});
const empowermentGroupSchema = z.object({
  name: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  skills: z.array(empowermentSkillSchema),
  shared: z.boolean(),
});
const characterSchema = namedEntitySchema.extend({
  cost: z.union([z.number().int(), z.array(z.number().int()).min(1)]),
  field: z.string().min(1),
  roles: z.array(z.string()),
  bonds: z.array(z.string()),
  empowerment: z.object({
    front: empowermentGroupSchema.nullable(),
    back: empowermentGroupSchema.nullable(),
    stars: z.record(z.string(), z.record(z.string(), z.union([z.string(), z.number()]))),
  }).passthrough(),
  recommended_equipment: z.array(z.string()).optional(),
  advisor: z.union([z.boolean(), z.record(z.string(), z.unknown()), z.null()]),
}).passthrough();
const bondSchema = namedEntitySchema.extend({
  category: z.string().min(1),
  members: z.array(z.string()),
  effects: z.record(z.string(), z.unknown()),
  base_effect: z.string().optional(),
  special_rules: z.array(z.string()).optional(),
}).passthrough();
const equipmentSchema = namedEntitySchema.extend({
  type: z.string().min(1),
  stats: z.record(z.string(), z.unknown()),
  effect: z.string().nullable(),
  recipe: z.array(z.string()).optional(),
  recipes: z.array(z.array(z.string()).min(2)).optional(),
  tags: z.array(z.string()).optional(),
  recommended_for: z.array(z.string()).optional(),
}).passthrough();
const strategySchema = namedEntitySchema.extend({
  rarity: z.string().min(1),
  effect: z.string().min(1),
  planes: z.array(z.number().int()),
}).passthrough();
const environmentSchema = namedEntitySchema.extend({ effect: z.string().nullable() }).passthrough();

const DATASET_CONFIG = {
  characters: { collection: "characters", schema: characterSchema },
  bonds: { collection: "bonds", schema: bondSchema },
  equipment: { collection: "equipment", schema: equipmentSchema },
  investment_environments: { collection: "environments", schema: environmentSchema },
  investment_strategies: { collection: "strategies", schema: strategySchema },
} as const;

export type CurrencyWarSimpleFile = {
  version: string;
  source: CurrencyWarSource;
  characters?: CurrencyWarCharacter[];
  bonds?: CurrencyWarBond[];
  equipment?: CurrencyWarEquipment[];
  environments?: CurrencyWarInvestmentEnvironment[];
  strategies?: CurrencyWarInvestmentStrategy[];
};

export function parseCurrencyWarSimpleFile(
  value: unknown,
  expectedDataset: CurrencyWarSimpleDataset,
  gameVersion: string,
): CurrencyWarSimpleFile {
  const base = baseDocumentSchema.safeParse(value);
  if (!base.success) throw new Error("CURRENCY_WAR_SIMPLE_SCHEMA_INVALID");
  if (base.data.version !== gameVersion) throw new Error("CURRENCY_WAR_SIMPLE_VERSION_MISMATCH");

  const config = DATASET_CONFIG[expectedDataset];
  const records = base.data[config.collection];
  const parsedRecords = z.array(config.schema).safeParse(records);
  if (!parsedRecords.success) throw new Error("CURRENCY_WAR_SIMPLE_SCHEMA_INVALID");
  assertNoForbiddenFields(parsedRecords.data);
  assertUniqueNames(parsedRecords.data);

  return { version: base.data.version, source: base.data.source, [config.collection]: parsedRecords.data } as CurrencyWarSimpleFile;
}

function assertUniqueNames(records: Array<{ name: string }>): void {
  const names = new Set<string>();
  for (const record of records) {
    if (names.has(record.name)) throw new Error("CURRENCY_WAR_SIMPLE_DUPLICATE_NAME");
    names.add(record.name);
  }
}

function assertNoForbiddenFields(records: Array<Record<string, unknown>>): void {
  const forbidden = new Set(["id", "names", "dataset", "records", "status", "review", "freshness", "evidence"]);
  for (const record of records) {
    if (Object.keys(record).some((key) => forbidden.has(key))) {
      throw new Error("CURRENCY_WAR_SIMPLE_FORBIDDEN_FIELD");
    }
  }
}
