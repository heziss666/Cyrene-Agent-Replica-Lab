import { z } from "zod";
import {
  CURRENCY_WAR_ENTITY_TYPES,
  type CurrencyWarEntity,
  type CurrencyWarEntityType,
  type CurrencyWarRuntimeDataset,
} from "./currency-war-data-types.js";

const entityTypeSchema = z.enum(CURRENCY_WAR_ENTITY_TYPES);

const entitySchema = z.object({
  id: z.string().min(1),
  names: z.object({
    zh_cn: z.string().min(1),
    aliases: z.array(z.string()).optional(),
  }).passthrough(),
  bond_ids: z.array(z.string()).optional(),
  member_ids: z.array(z.string()).optional(),
  related_character_ids: z.array(z.string()).optional(),
  related_bond_ids: z.array(z.string()).optional(),
  effect: z.object({
    current_text: z.string().nullable().optional(),
    status: z.string().optional(),
    parse_status: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

const runtimeDatasetSchema = z.object({
  schema_version: z.literal("3.0.0"),
  dataset: entityTypeSchema,
  game_version_target: z.string().min(1),
  generated_from: z.string().optional(),
  records: z.array(entitySchema),
}).strict();

export function parseCurrencyWarRuntimeFile(
  value: unknown,
  expectedDataset: CurrencyWarEntityType,
  gameVersion: string,
): CurrencyWarRuntimeDataset {
  const parsed = runtimeDatasetSchema.safeParse(value);
  if (!parsed.success) throw new Error("CURRENCY_WAR_RUNTIME_SCHEMA_INVALID");
  if (parsed.data.dataset !== expectedDataset) {
    throw new Error("CURRENCY_WAR_RUNTIME_DATASET_MISMATCH");
  }
  if (parsed.data.game_version_target !== gameVersion) {
    throw new Error("CURRENCY_WAR_RUNTIME_VERSION_MISMATCH");
  }

  const ids = new Set<string>();
  for (const record of parsed.data.records) {
    if (ids.has(record.id)) throw new Error("CURRENCY_WAR_RUNTIME_DUPLICATE_ID");
    ids.add(record.id);
  }

  return {
    schemaVersion: parsed.data.schema_version,
    dataset: parsed.data.dataset,
    gameVersion: parsed.data.game_version_target,
    ...(parsed.data.generated_from ? { generatedFrom: parsed.data.generated_from } : {}),
    records: parsed.data.records as CurrencyWarEntity[],
  };
}
