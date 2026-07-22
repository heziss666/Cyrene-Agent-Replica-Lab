import type { CurrencyWarCatalogEntity, CurrencyWarEntityType } from "./currency-war-data-types.js";
import type { CurrencyWarRuntimeSnapshot } from "./currency-war-runtime-loader.js";

export interface FindCurrencyWarEntityOptions { limit?: number; }

export interface CurrencyWarCatalog {
  getByName(name: string): CurrencyWarCatalogEntity | undefined;
  findByName(query: string, options?: FindCurrencyWarEntityOptions): CurrencyWarCatalogEntity[];
  getRelated(name: string): CurrencyWarCatalogEntity[];
  list(type: CurrencyWarEntityType): CurrencyWarCatalogEntity[];
}

export function createCurrencyWarCatalog(snapshot: CurrencyWarRuntimeSnapshot): CurrencyWarCatalog {
  const groups: Record<CurrencyWarEntityType, CurrencyWarCatalogEntity[]> = {
    characters: snapshot.characters,
    bonds: snapshot.bonds,
    equipment: snapshot.equipment,
    investment_environments: snapshot.investmentEnvironments,
    investment_strategies: snapshot.investmentStrategies,
  };
  const entities = new Map(groupsFlat(groups).map((entity) => [entity.name, entity]));

  return {
    getByName(name) { return clone(entities.get(name)); },
    findByName(query, options = {}) {
      const normalizedQuery = normalize(query);
      if (!normalizedQuery) return [];
      return groupsFlat(groups)
        .filter((entity) => [entity.name, ...(entity.aliases ?? [])].map(normalize).some((value) => value === normalizedQuery || value.includes(normalizedQuery)))
        .slice(0, options.limit ?? 20)
        .map(cloneEntity);
    },
    getRelated(name) {
      const entity = entities.get(name);
      if (!entity) return [];
      const relatedNames = stringArrayField(entity, "bonds")
        ?? stringArrayField(entity, "members")
        ?? stringArrayField(entity, "recipe")
        ?? [];
      return relatedNames.map((relatedName) => entities.get(relatedName)).filter((item): item is CurrencyWarCatalogEntity => item !== undefined).map(cloneEntity);
    },
    list(type) { return groups[type].map(cloneEntity); },
  };
}

function groupsFlat(groups: Record<CurrencyWarEntityType, CurrencyWarCatalogEntity[]>): CurrencyWarCatalogEntity[] {
  return Object.values(groups).flat();
}
function stringArrayField(entity: CurrencyWarCatalogEntity, key: string): string[] | undefined {
  const value = entity[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}
function normalize(value: string): string { return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, ""); }
function clone<T>(value: T | undefined): T | undefined { return value === undefined ? undefined : structuredClone(value); }
function cloneEntity(entity: CurrencyWarCatalogEntity): CurrencyWarCatalogEntity { return structuredClone(entity); }
