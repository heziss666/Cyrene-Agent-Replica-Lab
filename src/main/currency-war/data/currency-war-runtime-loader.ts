import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  CURRENCY_WAR_ENTITY_TYPES,
  type CurrencyWarEntity,
  type CurrencyWarEntityIndex,
  type CurrencyWarEntityIndexEntry,
  type CurrencyWarEntityType,
  type CurrencyWarGameRules,
  type CurrencyWarRuntimeDataset,
} from "./currency-war-data-types.js";
import { defaultCurrencyWarRuntimeDir } from "./currency-war-data-paths.js";
import { parseCurrencyWarRuntimeFile } from "./currency-war-data-schemas.js";

const DATASET_FILES: Record<CurrencyWarEntityType, string> = {
  characters: "characters.json",
  bonds: "bonds.json",
  equipment: "equipment.json",
  investment_environments: "investment_environments.json",
  investment_strategies: "investment_strategies.json",
};

const entityTypeSchema = z.enum(CURRENCY_WAR_ENTITY_TYPES);
const entityIndexSchema = z.object({
  schema_version: z.literal("3.0.0"),
  game_version_target: z.string().min(1),
  entities: z.record(z.string(), z.object({
    type: entityTypeSchema,
    name_zh: z.string().min(1),
    cost: z.number().optional(),
    bonds: z.array(z.string()).optional(),
  }).passthrough()),
}).strict();
const gameRulesSchema = z.object({
  schema_version: z.literal("3.0.0"),
  dataset: z.literal("game_rules"),
  game_version_target: z.string().min(1),
  economy: z.record(z.string(), z.unknown()),
  population: z.record(z.string(), z.unknown()),
  shop: z.record(z.string(), z.unknown()),
  board: z.record(z.string(), z.unknown()),
  nodes: z.record(z.string(), z.unknown()),
}).passthrough();

export interface CurrencyWarRuntimeSnapshot {
  gameVersion: string;
  datasets: Record<CurrencyWarEntityType, CurrencyWarRuntimeDataset>;
  entityIndex: CurrencyWarEntityIndex;
  gameRules: CurrencyWarGameRules;
}

export interface LoadCurrencyWarRuntimeOptions {
  runtimeDir?: string;
  gameVersion?: string;
}

export { defaultCurrencyWarRuntimeDir };

export async function loadCurrencyWarRuntime(
  options: LoadCurrencyWarRuntimeOptions = {},
): Promise<CurrencyWarRuntimeSnapshot> {
  const gameVersion = options.gameVersion ?? "4.4";
  const runtimeDir = options.runtimeDir ?? defaultCurrencyWarRuntimeDir(gameVersion);
  const datasets = {} as Record<CurrencyWarEntityType, CurrencyWarRuntimeDataset>;

  for (const entityType of CURRENCY_WAR_ENTITY_TYPES) {
    const json = await readJson(join(runtimeDir, DATASET_FILES[entityType]));
    datasets[entityType] = parseCurrencyWarRuntimeFile(json, entityType, gameVersion);
  }

  const entityIndex = parseEntityIndex(
    await readJson(join(runtimeDir, "entity_index.json")),
    gameVersion,
  );
  const gameRules = parseGameRules(
    await readJson(join(runtimeDir, "game_rules.json")),
    gameVersion,
  );

  validateCrossFileReferences(datasets, entityIndex);
  return { gameVersion, datasets, entityIndex, gameRules };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new Error("CURRENCY_WAR_RUNTIME_SCHEMA_INVALID");
  }
}

function parseEntityIndex(value: unknown, gameVersion: string): CurrencyWarEntityIndex {
  const parsed = entityIndexSchema.safeParse(value);
  if (!parsed.success) throw new Error("CURRENCY_WAR_RUNTIME_SCHEMA_INVALID");
  if (parsed.data.game_version_target !== gameVersion) {
    throw new Error("CURRENCY_WAR_RUNTIME_VERSION_MISMATCH");
  }
  const entities: Record<string, CurrencyWarEntityIndexEntry> = {};
  for (const [id, entry] of Object.entries(parsed.data.entities)) {
    entities[id] = {
      type: entry.type,
      nameZh: entry.name_zh,
      ...(entry.cost === undefined ? {} : { cost: entry.cost }),
      ...(entry.bonds === undefined ? {} : { bonds: [...entry.bonds] }),
    };
  }
  return {
    schemaVersion: parsed.data.schema_version,
    gameVersion: parsed.data.game_version_target,
    entities,
  };
}

function parseGameRules(value: unknown, gameVersion: string): CurrencyWarGameRules {
  const parsed = gameRulesSchema.safeParse(value);
  if (!parsed.success) throw new Error("CURRENCY_WAR_RUNTIME_SCHEMA_INVALID");
  if (parsed.data.game_version_target !== gameVersion) {
    throw new Error("CURRENCY_WAR_RUNTIME_VERSION_MISMATCH");
  }
  return {
    schemaVersion: parsed.data.schema_version,
    gameVersion: parsed.data.game_version_target,
    economy: parsed.data.economy,
    population: parsed.data.population,
    shop: parsed.data.shop,
    board: parsed.data.board,
    nodes: parsed.data.nodes,
  };
}

function validateCrossFileReferences(
  datasets: Record<CurrencyWarEntityType, CurrencyWarRuntimeDataset>,
  entityIndex: CurrencyWarEntityIndex,
): void {
  const owners = new Map<string, CurrencyWarEntityType>();
  for (const [entityType, dataset] of Object.entries(datasets) as Array<[CurrencyWarEntityType, CurrencyWarRuntimeDataset]>) {
    for (const entity of dataset.records) owners.set(entity.id, entityType);
  }

  for (const [id, entry] of Object.entries(entityIndex.entities)) {
    if (owners.get(id) !== entry.type) {
      throw new Error("CURRENCY_WAR_RUNTIME_INDEX_REFERENCE_MISSING");
    }
  }

  for (const dataset of Object.values(datasets)) {
    for (const entity of dataset.records) validateEntityRelations(entity, owners);
  }
}

function validateEntityRelations(
  entity: CurrencyWarEntity,
  owners: ReadonlyMap<string, CurrencyWarEntityType>,
): void {
  validateReferences(entity.bond_ids, "bonds", owners);
  validateReferences(entity.member_ids, "characters", owners);
  validateReferences(entity.related_character_ids, "characters", owners);
  validateReferences(entity.related_bond_ids, "bonds", owners);
}

function validateReferences(
  ids: readonly string[] | undefined,
  expectedType: CurrencyWarEntityType,
  owners: ReadonlyMap<string, CurrencyWarEntityType>,
): void {
  for (const id of ids ?? []) {
    if (owners.get(id) !== expectedType) {
      throw new Error("CURRENCY_WAR_RUNTIME_RELATION_REFERENCE_MISSING");
    }
  }
}
