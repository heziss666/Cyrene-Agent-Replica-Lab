import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CurrencyWarBond,
  CurrencyWarCharacter,
  CurrencyWarEquipment,
  CurrencyWarInvestmentEnvironment,
  CurrencyWarInvestmentStrategy,
} from "./currency-war-data-types.js";
import { defaultCurrencyWarRuntimeDir } from "./currency-war-data-paths.js";
import { parseCurrencyWarSimpleFile } from "./currency-war-data-schemas.js";

export interface CurrencyWarRuntimeSnapshot {
  gameVersion: string;
  characters: CurrencyWarCharacter[];
  bonds: CurrencyWarBond[];
  equipment: CurrencyWarEquipment[];
  investmentEnvironments: CurrencyWarInvestmentEnvironment[];
  investmentStrategies: CurrencyWarInvestmentStrategy[];
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
  const [charactersFile, bondsFile, equipmentFile, environmentsFile, strategiesFile] = await Promise.all([
    readRuntimeFile(runtimeDir, "characters.json", "characters", gameVersion),
    readRuntimeFile(runtimeDir, "bonds.json", "bonds", gameVersion),
    readRuntimeFile(runtimeDir, "equipment.json", "equipment", gameVersion),
    readRuntimeFile(runtimeDir, "investment_environments.json", "investment_environments", gameVersion),
    readRuntimeFile(runtimeDir, "investment_strategies.json", "investment_strategies", gameVersion),
  ]);

  const snapshot: CurrencyWarRuntimeSnapshot = {
    gameVersion,
    characters: charactersFile.characters ?? [],
    bonds: bondsFile.bonds ?? [],
    equipment: equipmentFile.equipment ?? [],
    investmentEnvironments: environmentsFile.environments ?? [],
    investmentStrategies: strategiesFile.strategies ?? [],
  };
  validateRelations(snapshot);
  return snapshot;
}

async function readRuntimeFile(
  runtimeDir: string,
  file: string,
  dataset: Parameters<typeof parseCurrencyWarSimpleFile>[1],
  gameVersion: string,
) {
  try {
    return parseCurrencyWarSimpleFile(JSON.parse(await readFile(join(runtimeDir, file), "utf8")), dataset, gameVersion);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("CURRENCY_WAR_SIMPLE_")) throw error;
    throw new Error("CURRENCY_WAR_SIMPLE_SCHEMA_INVALID");
  }
}

function validateRelations(snapshot: CurrencyWarRuntimeSnapshot): void {
  const characterNames = new Set(snapshot.characters.map((character) => character.name));
  const bondNames = new Set(snapshot.bonds.map((bond) => bond.name));
  const equipmentNames = new Set(snapshot.equipment.map((item) => item.name));

  for (const character of snapshot.characters) {
    for (const bondName of character.bonds) {
      if (!bondNames.has(bondName)) throw new Error("CURRENCY_WAR_SIMPLE_RELATION_REFERENCE_MISSING");
      const bond = snapshot.bonds.find((candidate) => candidate.name === bondName)!;
      if (!bond.members.includes(character.name)) throw new Error("CURRENCY_WAR_SIMPLE_RELATION_MISMATCH");
    }
  }
  for (const bond of snapshot.bonds) {
    for (const memberName of bond.members) {
      if (!characterNames.has(memberName)) throw new Error("CURRENCY_WAR_SIMPLE_RELATION_REFERENCE_MISSING");
    }
  }
  for (const item of snapshot.equipment) {
    for (const componentName of item.recipe ?? []) {
      if (!equipmentNames.has(componentName)) throw new Error("CURRENCY_WAR_SIMPLE_RELATION_REFERENCE_MISSING");
    }
  }
}
