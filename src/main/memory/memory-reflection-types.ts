import type { L0Field, L0Profile, L1Field, L1Profile, MemoryEvidence, MemorySourceSnapshot } from "./memory-types.js";

export type EntityType = "person" | "organization" | "project" | "technology" | "place" | "concept";

export interface ReflectionClaim {
  text: string;
  evidenceIds: string[];
}

export interface ReflectionProfileUpdate {
  layer: "L0" | "L1";
  field: L0Field | L1Field;
  content: string;
  sourceMemoryIds: string[];
  sourceSnapshots?: MemorySourceSnapshot[];
  claims: ReflectionClaim[];
  confidence: number;
  reason: string;
}

export interface ReflectionProposal {
  profileUpdates: ReflectionProfileUpdate[];
  compressionGroups: Array<{ sourceMemoryIds: string[]; reason: string }>;
  entities: Array<{ type: EntityType; name: string; sourceMemoryIds: string[] }>;
  relations: Array<{ fromName: string; toName: string; type: string; sourceMemoryIds: string[] }>;
}

export interface ReflectionSource {
  id: string;
  content: string;
  updatedAt: string;
}

export interface ReflectionEvidence {
  id: string;
  memoryId: string;
  quote: string;
  capturedAt: string;
}

export interface ReflectionInput {
  l0: L0Profile;
  l1: L1Profile;
  sources: ReflectionSource[];
  evidence: ReflectionEvidence[];
}

export interface ReflectionVerification {
  supported: boolean;
  confidence: number;
  claims: Array<{ claimIndex: number; supported: boolean; evidenceIds: string[] }>;
  reason: string;
}

export interface ReflectionVerificationInput {
  proposal: ReflectionProfileUpdate;
  sources: ReflectionSource[];
  evidence: Array<Pick<MemoryEvidence, "id" | "memoryId" | "quote" | "capturedAt">>;
}
