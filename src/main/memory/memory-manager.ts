import { randomUUID } from "node:crypto";
import {
  normalizeMemoryContent,
  validateModelMemoryContent,
} from "./memory-content-policy.js";
import {
  createMemoryConflictService,
  type MemoryConflictService,
} from "./memory-conflict-service.js";
import type { MemoryStore } from "./memory-store.js";
import type {
  L0Field,
  L0Profile,
  L1Field,
  L1Profile,
  MemoryFile,
  MemoryCandidate,
  MemoryWriteSummary,
} from "./memory-types.js";
import { initialMemoryWeight } from "./memory-types.js";

const l0Fields = new Set<L0Field>([
  "preferredName",
  "occupation",
  "longTermInterests",
  "language",
  "permanentNotes",
]);
const l1Fields = new Set<L1Field>([
  "currentProject",
  "recentGoals",
  "recentPreferences",
]);
const importanceValues = new Set(["low", "medium", "high"]);

interface ValidatedCandidateBase {
  content: string;
  confidence: number;
  importance: MemoryCandidate["importance"];
  evidenceQuote: string;
}

type ValidatedCandidate =
  | (ValidatedCandidateBase & { layer: "L0"; field: L0Field })
  | (ValidatedCandidateBase & { layer: "L1"; field: L1Field })
  | (ValidatedCandidateBase & {
    layer: "L2";
    importance: "medium" | "high";
  });

export interface MemoryManager {
  writeCandidates(input: {
    userMessage: string;
    candidates: MemoryCandidate[];
  }): Promise<MemoryWriteSummary>;
}

export type MemoryConflictEvent = {
  readonly type: "memory_conflict_detection_failed";
};

export const MEMORY_CONFLICT_DETECTION_FAILED_EVENT: MemoryConflictEvent = Object.freeze({
  type: "memory_conflict_detection_failed",
});

export function createMemoryManager(options: {
  store: MemoryStore;
  now?: () => Date;
  idFactory?: () => string;
  conflictService?: MemoryConflictService;
  onConflictEvent?: (event: MemoryConflictEvent) => void;
}): MemoryManager {
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;
  const conflictService = options.conflictService ?? createMemoryConflictService({
    store: options.store,
    vectorNeighbors: async () => [],
    recentInjectionIds: () => [],
  });

  return {
    async writeCandidates(input) {
      const writes: string[] = [];
      const writtenL2Ids: string[] = [];
      const timestamp = now().toISOString();

      await options.store.update((draft) => {
        for (const untrustedCandidate of input.candidates) {
          const validated = validateCandidate(untrustedCandidate, input.userMessage);
          if (!validated) continue;

          const persisted = persistCandidate(draft, validated, timestamp, idFactory);
          if (!persisted) continue;
          writes.push(persisted.write);
          if (persisted.l2MemoryId !== undefined) writtenL2Ids.push(persisted.l2MemoryId);
        }
      });

      for (const id of writtenL2Ids) {
        try {
          await conflictService.inspectNewMemory(id);
        } catch {
          try {
            options.onConflictEvent?.(MEMORY_CONFLICT_DETECTION_FAILED_EVENT);
          } catch {
            // Conflict reporting is best effort and must not affect a persisted memory.
          }
        }
      }

      return {
        candidateCount: input.candidates.length,
        writtenCount: writes.length,
        skippedCount: input.candidates.length - writes.length,
        writes,
      };
    },
  };
}

function validateCandidate(
  value: unknown,
  userMessage: string,
): ValidatedCandidate | undefined {
  if (!isRecord(value)
    || typeof value.layer !== "string"
    || typeof value.content !== "string"
    || typeof value.confidence !== "number"
    || !Number.isFinite(value.confidence)
    || value.confidence < 0
    || value.confidence > 1
    || typeof value.importance !== "string"
    || !importanceValues.has(value.importance)
    || typeof value.evidenceQuote !== "string"
    || typeof value.reason !== "string") {
    return undefined;
  }

  const policyResult = validateModelMemoryContent({
    userMessage,
    evidenceQuote: value.evidenceQuote,
    content: value.content,
  });
  if (!policyResult.ok) {
    return undefined;
  }
  const content = policyResult.content;

  const base = {
    content,
    confidence: value.confidence,
    importance: value.importance as MemoryCandidate["importance"],
    evidenceQuote: value.evidenceQuote,
  };

  if (value.layer === "L0"
    && typeof value.field === "string"
    && l0Fields.has(value.field as L0Field)
    && value.confidence >= 0.90) {
    return { ...base, layer: "L0", field: value.field as L0Field };
  }
  if (value.layer === "L1"
    && typeof value.field === "string"
    && l1Fields.has(value.field as L1Field)
    && value.confidence >= 0.80) {
    return { ...base, layer: "L1", field: value.field as L1Field };
  }
  if (value.layer === "L2"
    && value.field === undefined
    && value.confidence >= 0.80
    && (value.importance === "medium" || value.importance === "high")) {
    return {
      ...base,
      layer: "L2",
      importance: value.importance,
    };
  }
  return undefined;
}

function persistCandidate(
  draft: MemoryFile,
  candidate: ValidatedCandidate,
  timestamp: string,
  idFactory: () => string,
): { write: string; l2MemoryId?: string } | undefined {
  if (candidate.layer === "L0") {
    if (!writeL0(draft.l0, candidate.field, candidate.content)) return undefined;
    draft.l0.updatedAt = timestamp;
    return { write: `L0.${candidate.field}` };
  }

  if (candidate.layer === "L1") {
    if (!writeL1(draft.l1, candidate.field, candidate.content)) return undefined;
    draft.l1.updatedAt = timestamp;
    return { write: `L1.${candidate.field}` };
  }

  const contentKey = dedupeKey(candidate.content);
  if (draft.l2.some((memory) => dedupeKey(memory.content) === contentKey)) {
    return undefined;
  }
  const memoryId = idFactory();
  const evidenceId = idFactory();
  draft.l2.push({
    id: memoryId,
    content: candidate.content,
    confidence: candidate.confidence,
    importance: candidate.importance,
    evidenceIds: [evidenceId],
    createdAt: timestamp,
    updatedAt: timestamp,
    lastAccessedAt: timestamp,
    accessCount: 0,
    weight: initialMemoryWeight(candidate.importance, candidate.confidence),
    isPinned: false,
    isEnabled: true,
    status: "active",
    syncStatus: "pending_sync",
    isSummary: false,
    sourceMemoryIds: [],
    sourceSnapshots: [],
    conflictWith: [],
  });
  draft.evidence.push({
    id: evidenceId,
    memoryId,
    quote: candidate.evidenceQuote,
    capturedAt: timestamp,
    source: "conversation",
    sourceMemoryIds: [],
  });
  return { write: "L2", l2MemoryId: memoryId };
}

function writeL0(profile: L0Profile, field: L0Field, content: string): boolean {
  switch (field) {
    case "preferredName":
    case "occupation":
    case "language":
      return replaceSingleValue(profile, field, content);
    case "longTermInterests":
    case "permanentNotes":
      return appendUnique(profile[field], content);
  }
}

function writeL1(profile: L1Profile, field: L1Field, content: string): boolean {
  switch (field) {
    case "currentProject":
      return replaceSingleValue(profile, field, content);
    case "recentGoals":
    case "recentPreferences":
      return appendUnique(profile[field], content);
  }
}

function replaceSingleValue<
  Profile extends object,
  Field extends keyof Profile,
>(profile: Profile, field: Field, content: string): boolean {
  const current = profile[field];
  if (typeof current === "string" && dedupeKey(current) === dedupeKey(content)) {
    return false;
  }
  profile[field] = content as Profile[Field];
  return true;
}

function appendUnique(values: string[], content: string): boolean {
  const contentKey = dedupeKey(content);
  if (values.some((value) => dedupeKey(value) === contentKey)) return false;
  values.push(content);
  return true;
}

function dedupeKey(value: string): string {
  // Uppercasing uses built-in multi-character expansions such as ß -> SS.
  return normalizeMemoryContent(normalizeMemoryContent(value).toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
