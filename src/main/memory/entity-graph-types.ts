import type { EntityType } from "./memory-reflection-types.js";

export interface EntityGraphNode { id: string; type: EntityType; name: string; sourceMemoryIds: string[] }
export interface EntityGraphRelation { id: string; fromId: string; toId: string; type: string; sourceMemoryIds: string[] }
export interface EntityGraphFile { schemaVersion: 1; generatedAt: string; nodes: EntityGraphNode[]; relations: EntityGraphRelation[] }
export interface EntityExtraction { entities: Array<{ type: EntityType; name: string; sourceMemoryIds: string[] }>; relations: Array<{ fromName: string; toName: string; type: string; sourceMemoryIds: string[] }> }
export function emptyEntityGraph(generatedAt = new Date(0).toISOString()): EntityGraphFile { return { schemaVersion: 1, generatedAt, nodes: [], relations: [] }; }
