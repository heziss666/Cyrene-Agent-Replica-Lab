import type { CurrencyWarRuntime } from "../currency-war-runtime.js";
import {
  CURRENCY_WAR_ENTITY_TYPES,
  type CurrencyWarCatalogEntity,
  type CurrencyWarEntityType,
} from "../data/currency-war-data-types.js";

const MAX_FACT_RECORDS = 30;
const UNRECORDED = "本地资料未记录";

export interface CurrencyWarFactRecord {
  type: CurrencyWarEntityType;
  name: string;
  data: Record<string, unknown>;
}

export interface CurrencyWarFactResult {
  gameVersion: string;
  records: CurrencyWarFactRecord[];
  unknownNames: string[];
}

export interface CurrencyWarFactService {
  readonly gameVersion: string;
  lookup(names: readonly string[], includeRelated?: boolean): CurrencyWarFactResult;
  matchText(text: string): CurrencyWarFactRecord[];
  format(records: readonly CurrencyWarFactRecord[]): string;
}

interface IndexedFact {
  record: CurrencyWarFactRecord;
  searchNames: string[];
}

export function createCurrencyWarFactService(
  runtime: CurrencyWarRuntime,
): CurrencyWarFactService {
  const indexed = CURRENCY_WAR_ENTITY_TYPES.flatMap((type) =>
    runtime.catalog.list(type).map((entity) => toIndexedFact(type, entity)));
  const exact = new Map<string, IndexedFact>();
  for (const item of indexed) {
    for (const name of item.searchNames) {
      if (!exact.has(name)) exact.set(name, item);
    }
  }

  return {
    gameVersion: runtime.gameVersion,
    lookup(names, includeRelated = false) {
      const records: CurrencyWarFactRecord[] = [];
      const unknownNames: string[] = [];
      const seen = new Set<string>();

      for (const rawName of names) {
        const name = rawName.trim();
        if (!name) continue;
        const item = exact.get(normalize(name));
        if (!item) {
          unknownNames.push(name);
          continue;
        }
        append(item.record, records, seen);
        if (includeRelated) {
          for (const related of runtime.catalog.getRelated(item.record.name)) {
            const relatedItem = exact.get(normalize(related.name));
            if (relatedItem) append(relatedItem.record, records, seen);
          }
        }
        if (records.length >= MAX_FACT_RECORDS) break;
      }

      return {
        gameVersion: runtime.gameVersion,
        records,
        unknownNames: [...new Set(unknownNames)],
      };
    },
    matchText(text) {
      const normalizedText = normalize(text);
      return indexed
        .flatMap((item) => {
          const positions = item.searchNames
            .filter((name) => name.length >= 2)
            .map((name) => normalizedText.indexOf(name))
            .filter((position) => position >= 0);
          return positions.length > 0
            ? [{ item, position: Math.min(...positions) }]
            : [];
        })
        .sort((a, b) => a.position - b.position || b.item.record.name.length - a.item.record.name.length)
        .filter(({ item }, index, matches) =>
          matches.findIndex((candidate) => candidate.item.record.name === item.record.name) === index)
        .slice(0, MAX_FACT_RECORDS)
        .map(({ item }) => structuredClone(item.record));
    },
    format(records) {
      if (records.length === 0) return "未命中本地结构化资料。";
      return records.map((record) => [
        `- [${record.type}] ${record.name}`,
        indent(JSON.stringify(
          record.data,
          (_key, value) => value === null ? UNRECORDED : value,
          2,
        )),
      ].join("\n")).join("\n");
    },
  };
}

function toIndexedFact(
  type: CurrencyWarEntityType,
  entity: CurrencyWarCatalogEntity,
): IndexedFact {
  const { name, aliases, ...data } = structuredClone(entity);
  return {
    record: { type, name, data },
    searchNames: [name, ...(aliases ?? [])].map(normalize).filter(Boolean),
  };
}

function append(
  record: CurrencyWarFactRecord,
  records: CurrencyWarFactRecord[],
  seen: Set<string>,
): void {
  const key = `${record.type}:${record.name}`;
  if (seen.has(key) || records.length >= MAX_FACT_RECORDS) return;
  seen.add(key);
  records.push(structuredClone(record));
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
}

function indent(value: string): string {
  return value.split("\n").map((line) => `  ${line}`).join("\n");
}
