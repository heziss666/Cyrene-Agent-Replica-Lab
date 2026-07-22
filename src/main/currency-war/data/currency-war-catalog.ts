import type {
  CurrencyWarEntity,
  CurrencyWarEntityType,
} from "./currency-war-data-types.js";
import type { CurrencyWarRuntimeSnapshot } from "./currency-war-runtime-loader.js";

export interface FindCurrencyWarEntityOptions {
  limit?: number;
}

export interface CurrencyWarCatalog {
  getById(id: string): CurrencyWarEntity | undefined;
  findByName(query: string, options?: FindCurrencyWarEntityOptions): CurrencyWarEntity[];
  getRelated(id: string): CurrencyWarEntity[];
  list(type: CurrencyWarEntityType): CurrencyWarEntity[];
}

export function createCurrencyWarCatalog(snapshot: CurrencyWarRuntimeSnapshot): CurrencyWarCatalog {
  const entities = new Map<string, CurrencyWarEntity>();
  const entityTypes = new Map<string, CurrencyWarEntityType>();

  for (const [entityType, dataset] of Object.entries(snapshot.datasets) as Array<[
    CurrencyWarEntityType,
    (typeof snapshot.datasets)[CurrencyWarEntityType],
  ]>) {
    for (const entity of dataset.records) {
      entities.set(entity.id, entity);
      entityTypes.set(entity.id, entityType);
    }
  }

  return {
    getById(id) {
      return clone(entities.get(id));
    },
    findByName(query, options = {}) {
      const normalizedQuery = normalize(query);
      if (!normalizedQuery) return [];

      const matched = [...entities.values()].filter((entity) => {
        const names = [entity.names.zh_cn, ...(entity.names.aliases ?? [])].map(normalize);
        return names.some((name) => name === normalizedQuery || name.includes(normalizedQuery));
      });
      return matched.slice(0, options.limit ?? 20).map(cloneEntity);
    },
    getRelated(id) {
      const entity = entities.get(id);
      if (!entity) return [];

      const relationIds = new Set<string>([
        ...(entity.bond_ids ?? []),
        ...(entity.member_ids ?? []),
        ...(entity.related_character_ids ?? []),
        ...(entity.related_bond_ids ?? []),
      ]);
      return [...relationIds]
        .map((relationId) => entities.get(relationId))
        .filter((candidate): candidate is CurrencyWarEntity => candidate !== undefined)
        .map(cloneEntity);
    },
    list(type) {
      return [...entities.entries()]
        .filter(([id]) => entityTypes.get(id) === type)
        .map(([, entity]) => cloneEntity(entity));
    },
  };
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
}

function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}

function cloneEntity(entity: CurrencyWarEntity): CurrencyWarEntity {
  return structuredClone(entity);
}
