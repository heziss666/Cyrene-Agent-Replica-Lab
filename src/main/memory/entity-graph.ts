import { readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeFileAtomically } from "../rag/atomic-file-write.js";
import { normalizeMemoryContent } from "./memory-content-policy.js";
import { defaultMemoryPath } from "./memory-store.js";
import { emptyEntityGraph, type EntityExtraction, type EntityGraphFile, type EntityGraphNode, type EntityGraphRelation } from "./entity-graph-types.js";
import type { MemoryFile } from "./memory-types.js";

export class EntityGraphService {
  private graph?: EntityGraphFile;
  constructor(private readonly options: { filePath?: string; atomicWrite?: (path: string, content: string) => Promise<void>; now?: () => Date; quarantineNow?: () => number } = {}) {}
  async load(): Promise<EntityGraphFile> {
    if (this.graph) return structuredClone(this.graph);
    const path = this.path();
    try { this.graph = validateGraph(JSON.parse(await readFile(path, "utf8"))); }
    catch (error) {
      if (!isMissing(error)) { try { await rename(path, `${path}.corrupt-${(this.options.quarantineNow ?? Date.now)()}`); } catch { /* best effort */ } }
      this.graph = emptyEntityGraph();
    }
    return structuredClone(this.graph);
  }
  snapshot(): EntityGraphFile { return structuredClone(this.graph ?? emptyEntityGraph()); }
  async rebuild(memoryFile: MemoryFile, extraction: EntityExtraction = { entities: [], relations: [] }): Promise<EntityGraphFile> {
    const active = new Set(memoryFile.l2.filter((memory) => memory.isEnabled && (memory.status === "active" || memory.status === "aging")).map(({ id }) => id));
    const nodesById = new Map<string, EntityGraphNode>();
    for (const entity of extraction.entities) {
      const sourceMemoryIds = [...new Set(entity.sourceMemoryIds.filter((id) => active.has(id)))].sort(); if (!sourceMemoryIds.length) continue;
      const id = nodeId(entity.type, entity.name); const prior = nodesById.get(id);
      nodesById.set(id, { id, type: entity.type, name: normalizeMemoryContent(entity.name), sourceMemoryIds: [...new Set([...(prior?.sourceMemoryIds ?? []), ...sourceMemoryIds])].sort() });
    }
    const nodes = [...nodesById.values()].sort((a, b) => a.id.localeCompare(b.id)); const names = new Map(nodes.map((node) => [normalize(node.name), node]));
    const relationsById = new Map<string, EntityGraphRelation>();
    for (const relation of extraction.relations) {
      const from = names.get(normalize(relation.fromName)); const to = names.get(normalize(relation.toName)); if (!from || !to) continue;
      const sourceMemoryIds = [...new Set(relation.sourceMemoryIds.filter((id) => active.has(id) && from.sourceMemoryIds.includes(id) && to.sourceMemoryIds.includes(id)))].sort(); if (!sourceMemoryIds.length) continue;
      const type = normalizeMemoryContent(relation.type); const id = `${from.id}->${normalize(type)}->${to.id}`; const prior = relationsById.get(id);
      relationsById.set(id, { id, fromId: from.id, toId: to.id, type, sourceMemoryIds: [...new Set([...(prior?.sourceMemoryIds ?? []), ...sourceMemoryIds])].sort() });
    }
    const next: EntityGraphFile = { schemaVersion: 1, generatedAt: (this.options.now ?? (() => new Date()))().toISOString(), nodes, relations: [...relationsById.values()].sort((a, b) => a.id.localeCompare(b.id)) };
    await (this.options.atomicWrite ?? writeFileAtomically)(this.path(), `${JSON.stringify(next, null, 2)}\n`);
    this.graph = next; return structuredClone(next);
  }
  private path(): string { return this.options.filePath ?? join(dirname(defaultMemoryPath()), "entity-graph.json"); }
}
function nodeId(type: string, name: string): string { return `${type}:${normalize(name)}`; }
function normalize(value: string): string { return normalizeMemoryContent(value).toLocaleLowerCase(); }
function validateGraph(value: unknown): EntityGraphFile {
  if (!record(value) || Object.keys(value).sort().join(",") !== "generatedAt,nodes,relations,schemaVersion"
    || value.schemaVersion !== 1 || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))
    || !Array.isArray(value.nodes) || !Array.isArray(value.relations)) throw new Error("Invalid entity graph");
  const nodes = value.nodes.map((raw) => {
    if (!record(raw) || Object.keys(raw).sort().join(",") !== "id,name,sourceMemoryIds,type" || typeof raw.id !== "string" || typeof raw.name !== "string" || typeof raw.type !== "string" || !Array.isArray(raw.sourceMemoryIds) || raw.sourceMemoryIds.some((id) => typeof id !== "string")) throw new Error("Invalid entity graph");
    return { id: raw.id, name: raw.name, type: raw.type, sourceMemoryIds: [...raw.sourceMemoryIds] } as EntityGraphNode;
  });
  const nodeIds = new Set(nodes.map(({ id }) => id));
  const relations = value.relations.map((raw) => {
    if (!record(raw) || Object.keys(raw).sort().join(",") !== "fromId,id,sourceMemoryIds,toId,type" || typeof raw.id !== "string" || typeof raw.fromId !== "string" || typeof raw.toId !== "string" || !nodeIds.has(raw.fromId) || !nodeIds.has(raw.toId) || typeof raw.type !== "string" || !Array.isArray(raw.sourceMemoryIds) || raw.sourceMemoryIds.some((id) => typeof id !== "string")) throw new Error("Invalid entity graph");
    return { id: raw.id, fromId: raw.fromId, toId: raw.toId, type: raw.type, sourceMemoryIds: [...raw.sourceMemoryIds] };
  });
  if (new Set(nodes.map(({ id }) => id)).size !== nodes.length || new Set(relations.map(({ id }) => id)).size !== relations.length) throw new Error("Invalid entity graph");
  return { schemaVersion: 1, generatedAt: value.generatedAt, nodes, relations };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isMissing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"; }
