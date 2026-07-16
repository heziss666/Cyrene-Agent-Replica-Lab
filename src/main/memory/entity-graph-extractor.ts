import { normalizeMemoryContent } from "./memory-content-policy.js";
import type { EntityExtraction } from "./entity-graph-types.js";
import type { EntityType } from "./memory-reflection-types.js";
import type { MemoryFile } from "./memory-types.js";

const TYPES = new Set<EntityType>(["user", "person", "project", "technology", "place", "organization", "event", "topic"]);
export function validateEntityExtraction(value: unknown, file: MemoryFile): EntityExtraction {
  if (!record(value) || Object.keys(value).sort().join(",") !== "entities,relations" || !Array.isArray(value.entities) || !Array.isArray(value.relations)) throw invalid();
  const eligible = new Set(file.l2.filter((memory) => memory.isEnabled && (memory.status === "active" || memory.status === "aging")).map(({ id }) => id));
  const entities = value.entities.map((raw) => {
    if (!record(raw) || Object.keys(raw).sort().join(",") !== "name,sourceMemoryIds,type" || typeof raw.type !== "string" || !TYPES.has(raw.type as EntityType) || typeof raw.name !== "string" || !raw.name.trim()) throw invalid();
    const sourceMemoryIds = ids(raw.sourceMemoryIds, eligible); const name = normalizeMemoryContent(raw.name);
    const sourceText = file.l2.filter(({ id }) => sourceMemoryIds.includes(id)).map(({ content }) => content).concat(file.evidence.filter(({ memoryId }) => sourceMemoryIds.includes(memoryId)).map(({ quote }) => quote));
    if (!sourceText.some((text) => normalizeMemoryContent(text).includes(name))) throw invalid();
    return { type: raw.type as EntityType, name, sourceMemoryIds };
  });
  const byName = new Map(entities.map((entity) => [normalize(entity.name), entity]));
  const relations = value.relations.map((raw) => {
    if (!record(raw) || Object.keys(raw).sort().join(",") !== "fromName,sourceMemoryIds,toName,type" || typeof raw.fromName !== "string" || typeof raw.toName !== "string" || typeof raw.type !== "string" || !raw.type.trim()) throw invalid();
    const from = byName.get(normalize(raw.fromName)); const to = byName.get(normalize(raw.toName)); if (!from || !to) throw invalid();
    const sourceMemoryIds = ids(raw.sourceMemoryIds, eligible);
    if (sourceMemoryIds.some((id) => !from.sourceMemoryIds.includes(id) || !to.sourceMemoryIds.includes(id))) throw invalid();
    return { fromName: from.name, toName: to.name, type: normalizeMemoryContent(raw.type), sourceMemoryIds };
  });
  return { entities, relations };
}
function ids(value: unknown, allowed: Set<string>): string[] { if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length || value.some((id) => typeof id !== "string" || !allowed.has(id))) throw invalid(); return [...value] as string[]; }
function normalize(value: string): string { return normalizeMemoryContent(value).toLocaleLowerCase(); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function invalid(): Error { return new Error("Invalid entity graph extraction"); }
