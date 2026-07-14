import { randomUUID } from "node:crypto";
import { readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  recoverInterruptedAtomicWrite,
  writeFileAtomically,
} from "../rag/atomic-file-write.js";
import {
  createEmptyMemoryFileV2,
  initialMemoryWeight,
  type ConflictLog,
  type L0Field,
  type L0Profile,
  type L1Field,
  type L1Profile,
  type L2MemoryV1,
  type L2MemoryV2,
  type MemoryAuditEntry,
  type MemoryEvidence,
  type MemoryFile,
  type MemoryFileV1,
  type MemoryFileV2,
  type ProfileFieldMetadata,
  type ReflectionLog,
} from "./memory-types.js";

export interface MemoryStore {
  load(): Promise<MemoryFile>;
  update(mutator: (draft: MemoryFile) => void): Promise<MemoryFile>;
}

export interface CreateMemoryStoreOptions {
  filePath?: string;
  atomicWrite?: (filePath: string, content: string) => Promise<void>;
  now?: () => number;
  idFactory?: () => string;
}

class MemoryFileValidationError extends Error {
  constructor(message: string) {
    super(`Invalid memory file: ${message}`);
    this.name = "MemoryFileValidationError";
  }
}

function invalid(message: string): Error {
  return new MemoryFileValidationError(message);
}

export function isMemoryFileValidationError(error: unknown): boolean {
  return error instanceof MemoryFileValidationError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)) {
    throw invalid(`${label} must be a plain object`);
  }
  return value;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string") throw invalid(`${label} must be a string`);
  return value;
}

function assertOptionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : assertString(value, label);
}

function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw invalid(`${label} must be a boolean`);
  return value;
}

function assertFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid(`${label} must be a finite number`);
  }
  return value;
}

function assertInteger(value: unknown, label: string): number {
  const number = assertFiniteNumber(value, label);
  if (!Number.isInteger(number)) throw invalid(`${label} must be an integer`);
  return number;
}

function assertRange(value: unknown, label: string, minimum: number, maximum: number): number {
  const number = assertFiniteNumber(value, label);
  if (number < minimum || number > maximum) {
    throw invalid(`${label} must be between ${minimum} and ${maximum}`);
  }
  return number;
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw invalid(`${label} must be an array of strings`);
  }
  return [...value];
}

function assertEnum<const T extends string>(
  value: unknown,
  label: string,
  values: readonly T[],
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw invalid(`${label} must be one of ${values.join(", ")}`);
  }
  return value as T;
}

function validateProfileMetadata(
  value: unknown,
  label: string,
  fields: readonly string[],
): void {
  if (value === undefined) return;
  const metadata = assertPlainObject(value, label);
  for (const [field, rawEntry] of Object.entries(metadata)) {
    if (!fields.includes(field)) throw invalid(`${label}.${field} is not a supported field`);
    const entry = assertPlainObject(rawEntry, `${label}.${field}`);
    assertString(entry.updatedAt, `${label}.${field}.updatedAt`);
    assertEnum(entry.source, `${label}.${field}.source`, [
      "judge", "reflection", "user_edit", "resolver",
    ]);
    if (entry.confidence !== undefined) {
      assertRange(entry.confidence, `${label}.${field}.confidence`, 0, 1);
    }
  }
}

function validateL0Profile(value: unknown, allowMetadata: boolean): L0Profile {
  const profile = assertPlainObject(value, "l0");
  const validated: L0Profile = {
    longTermInterests: assertStringArray(profile.longTermInterests, "l0.longTermInterests"),
    permanentNotes: assertStringArray(profile.permanentNotes, "l0.permanentNotes"),
  };
  for (const field of ["preferredName", "occupation", "language", "updatedAt"] as const) {
    const entry = assertOptionalString(profile[field], `l0.${field}`);
    if (entry !== undefined) validated[field] = entry;
  }
  if (allowMetadata) {
    validateProfileMetadata(profile.fieldMetadata, "l0.fieldMetadata", [
      "preferredName", "occupation", "longTermInterests", "language", "permanentNotes",
    ]);
  }
  return validated;
}

function validateL1Profile(value: unknown, allowMetadata: boolean): L1Profile {
  const profile = assertPlainObject(value, "l1");
  const validated: L1Profile = {
    recentGoals: assertStringArray(profile.recentGoals, "l1.recentGoals"),
    recentPreferences: assertStringArray(profile.recentPreferences, "l1.recentPreferences"),
  };
  for (const field of ["currentProject", "updatedAt"] as const) {
    const entry = assertOptionalString(profile[field], `l1.${field}`);
    if (entry !== undefined) validated[field] = entry;
  }
  if (allowMetadata) {
    validateProfileMetadata(profile.fieldMetadata, "l1.fieldMetadata", [
      "currentProject", "recentGoals", "recentPreferences",
    ]);
  }
  return validated;
}

function validateL2MemoryV1(value: unknown, index: number): L2MemoryV1 {
  const label = `l2[${index}]`;
  const memory = assertPlainObject(value, label);
  const evidence = assertPlainObject(memory.evidence, `${label}.evidence`);
  return {
    id: assertString(memory.id, `${label}.id`),
    content: assertString(memory.content, `${label}.content`),
    confidence: assertRange(memory.confidence, `${label}.confidence`, 0, 1),
    importance: assertEnum(memory.importance, `${label}.importance`, ["medium", "high"]),
    evidence: {
      userQuote: assertString(evidence.userQuote, `${label}.evidence.userQuote`),
      capturedAt: assertString(evidence.capturedAt, `${label}.evidence.capturedAt`),
    },
    createdAt: assertString(memory.createdAt, `${label}.createdAt`),
    status: assertEnum(memory.status, `${label}.status`, ["active"]),
  };
}

function validateMemoryFileV1(value: unknown): MemoryFileV1 {
  const file = assertPlainObject(value, "file");
  if (file.schemaVersion !== 1) throw invalid("schemaVersion must be 1 or 2");
  if (!Array.isArray(file.l2)) throw invalid("l2 must be an array");
  validateL0Profile(file.l0, false);
  validateL1Profile(file.l1, false);
  file.l2.map(validateL2MemoryV1);
  return structuredClone(value as MemoryFileV1);
}

function validateL2MemoryV2(value: unknown, index: number): L2MemoryV2 {
  const label = `l2[${index}]`;
  const memory = assertPlainObject(value, label);
  if (!Array.isArray(memory.sourceSnapshots)) {
    throw invalid(`${label}.sourceSnapshots must be an array`);
  }
  const result: L2MemoryV2 = {
    id: assertString(memory.id, `${label}.id`),
    content: assertString(memory.content, `${label}.content`),
    confidence: assertRange(memory.confidence, `${label}.confidence`, 0, 1),
    importance: assertEnum(memory.importance, `${label}.importance`, ["medium", "high"]),
    evidenceIds: assertStringArray(memory.evidenceIds, `${label}.evidenceIds`),
    createdAt: assertString(memory.createdAt, `${label}.createdAt`),
    updatedAt: assertString(memory.updatedAt, `${label}.updatedAt`),
    lastAccessedAt: assertString(memory.lastAccessedAt, `${label}.lastAccessedAt`),
    accessCount: assertInteger(memory.accessCount, `${label}.accessCount`),
    weight: assertRange(memory.weight, `${label}.weight`, 0, 1),
    isPinned: assertBoolean(memory.isPinned, `${label}.isPinned`),
    isEnabled: assertBoolean(memory.isEnabled, `${label}.isEnabled`),
    status: assertEnum(memory.status, `${label}.status`, [
      "active", "aging", "archived", "superseded", "merged",
    ]),
    syncStatus: assertEnum(memory.syncStatus, `${label}.syncStatus`, [
      "pending_sync", "synced", "sync_failed",
    ]),
    isSummary: assertBoolean(memory.isSummary, `${label}.isSummary`),
    sourceMemoryIds: assertStringArray(memory.sourceMemoryIds, `${label}.sourceMemoryIds`),
    sourceSnapshots: memory.sourceSnapshots.map((rawSnapshot, snapshotIndex) => {
      const snapshot = assertPlainObject(rawSnapshot, `${label}.sourceSnapshots[${snapshotIndex}]`);
      return {
        memoryId: assertString(snapshot.memoryId, `${label}.sourceSnapshots[${snapshotIndex}].memoryId`),
        updatedAt: assertString(snapshot.updatedAt, `${label}.sourceSnapshots[${snapshotIndex}].updatedAt`),
      };
    }),
    conflictWith: assertStringArray(memory.conflictWith, `${label}.conflictWith`),
  };
  for (const field of ["supersededBy", "mergedInto"] as const) {
    const entry = assertOptionalString(memory[field], `${label}.${field}`);
    if (entry !== undefined) result[field] = entry;
  }
  return result;
}

function validateEvidence(value: unknown, index: number): MemoryEvidence {
  const label = `evidence[${index}]`;
  const evidence = assertPlainObject(value, label);
  return {
    id: assertString(evidence.id, `${label}.id`),
    memoryId: assertString(evidence.memoryId, `${label}.memoryId`),
    quote: assertString(evidence.quote, `${label}.quote`),
    capturedAt: assertString(evidence.capturedAt, `${label}.capturedAt`),
    source: assertEnum(evidence.source, `${label}.source`, [
      "conversation", "user_edit", "reflection", "resolver",
    ]),
    sourceMemoryIds: assertStringArray(evidence.sourceMemoryIds, `${label}.sourceMemoryIds`),
  };
}

function assertObjectArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw invalid(`${label} must be an array`);
  return value;
}

function optionalFiniteNumber(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : assertFiniteNumber(value, label);
}

function validateConflictLog(value: unknown, index: number): ConflictLog {
  const label = `conflictLogs[${index}]`;
  const conflict = assertPlainObject(value, label);
  const signals = assertPlainObject(conflict.signals, `${label}.signals`);
  const result: ConflictLog = {
    id: assertString(conflict.id, `${label}.id`),
    sourceMemoryId: assertString(conflict.sourceMemoryId, `${label}.sourceMemoryId`),
    targetMemoryId: assertString(conflict.targetMemoryId, `${label}.targetMemoryId`),
    createdAt: assertString(conflict.createdAt, `${label}.createdAt`),
    status: assertEnum(conflict.status, `${label}.status`, [
      "queued", "processing", "resolved", "uncertain", "failed",
    ]),
    score: assertFiniteNumber(conflict.score, `${label}.score`),
    priority: assertEnum(conflict.priority, `${label}.priority`, ["idle", "normal", "high"]),
    attempts: assertInteger(conflict.attempts, `${label}.attempts`),
    signals: {},
  };
  for (const field of [
    "score", "semanticSimilarity", "contradictionScore", "entityOverlap", "temporalOverlap",
  ] as const) {
    const entry = optionalFiniteNumber(signals[field], `${label}.signals.${field}`);
    if (entry !== undefined) result.signals[field] = entry;
  }
  if (conflict.resolutionType !== undefined) {
    result.resolutionType = assertEnum(conflict.resolutionType, `${label}.resolutionType`, [
      "unrelated", "context_difference", "preference_evolution", "direct_conflict", "uncertain",
    ]);
  }
  for (const field of ["resolutionReason", "finishedAt"] as const) {
    const entry = assertOptionalString(conflict[field], `${label}.${field}`);
    if (entry !== undefined) result[field] = entry;
  }
  const resolutionConfidence = optionalFiniteNumber(
    conflict.resolutionConfidence,
    `${label}.resolutionConfidence`,
  );
  if (resolutionConfidence !== undefined) result.resolutionConfidence = resolutionConfidence;
  return result;
}

function validateReflectionLog(value: unknown, index: number): ReflectionLog {
  const label = `reflectionLogs[${index}]`;
  const reflection = assertPlainObject(value, label);
  return {
    id: assertString(reflection.id, `${label}.id`),
    createdAt: assertString(reflection.createdAt, `${label}.createdAt`),
    type: assertEnum(reflection.type, `${label}.type`, [
      "compression", "l0_update", "l1_update", "lifecycle",
    ]),
    sourceMemoryIds: assertStringArray(reflection.sourceMemoryIds, `${label}.sourceMemoryIds`),
    acceptedCount: assertInteger(reflection.acceptedCount, `${label}.acceptedCount`),
    skippedCount: assertInteger(reflection.skippedCount, `${label}.skippedCount`),
  };
}

function validateAuditLog(value: unknown, index: number): MemoryAuditEntry {
  const label = `auditLogs[${index}]`;
  const audit = assertPlainObject(value, label);
  const result: MemoryAuditEntry = {
    id: assertString(audit.id, `${label}.id`),
    createdAt: assertString(audit.createdAt, `${label}.createdAt`),
    operation: assertString(audit.operation, `${label}.operation`),
    targetType: assertString(audit.targetType, `${label}.targetType`),
    source: assertEnum(audit.source, `${label}.source`, ["automatic", "user", "system"]),
    result: assertEnum(audit.result, `${label}.result`, ["success", "skipped", "failed"]),
  };
  for (const field of ["targetId", "field", "code"] as const) {
    const entry = assertOptionalString(audit[field], `${label}.${field}`);
    if (entry !== undefined) result[field] = entry;
  }
  return result;
}

function validateMemoryFileV2Shape(value: unknown): asserts value is MemoryFileV2 {
  const file = assertPlainObject(value, "file");
  if (file.schemaVersion !== 2) throw invalid("schemaVersion must be 2");
  if (!Array.isArray(file.l2)) throw invalid("l2 must be an array");
  if (!Array.isArray(file.evidence)) throw invalid("evidence must be an array");
  validateL0Profile(file.l0, true);
  validateL1Profile(file.l1, true);
  file.l2.map(validateL2MemoryV2);
  file.evidence.map(validateEvidence);
  assertObjectArray(file.conflictLogs, "conflictLogs").map(validateConflictLog);
  assertObjectArray(file.reflectionLogs, "reflectionLogs").map(validateReflectionLog);
  assertObjectArray(file.auditLogs, "auditLogs").map(validateAuditLog);
  const maintenance = assertPlainObject(file.maintenance, "maintenance");
  assertInteger(
    maintenance.successfulWritesSinceMaintenance,
    "maintenance.successfulWritesSinceMaintenance",
  );
  assertBoolean(maintenance.running, "maintenance.running");
  for (const field of [
    "lastDecayAt", "lastMaintenanceAt", "lastReflectionAt", "lastCompressionAt",
    "lastEntityGraphAt", "lastErrorCode",
  ] as const) {
    assertOptionalString(maintenance[field], `maintenance.${field}`);
  }
}

export function validateMemoryFile(value: unknown): MemoryFile {
  validateMemoryFileV2Shape(value);
  return structuredClone(value);
}

function metadataForProfile(
  profile: L0Profile | L1Profile,
  fields: readonly (L0Field | L1Field)[],
  timestamp: string,
): Partial<Record<L0Field | L1Field, ProfileFieldMetadata>> {
  const metadata: Partial<Record<L0Field | L1Field, ProfileFieldMetadata>> = {};
  for (const field of fields) {
    const value = profile[field as keyof typeof profile];
    if (typeof value === "string" ? value.length > 0 : Array.isArray(value) && value.length > 0) {
      metadata[field] = { updatedAt: profile.updatedAt ?? timestamp, source: "judge" };
    }
  }
  return metadata;
}

/** Internal bridge used by memory-migrations; structural parsers stay Store-owned. */
export function migrateMemoryFileForMigration(
  value: unknown,
  now: () => number,
  idFactory: () => string,
): MemoryFileV2 {
  if (isRecord(value) && value.schemaVersion === 2) return validateMemoryFile(value);
  const v1 = validateMemoryFileV1(value);
  const timestamp = new Date(now()).toISOString();
  const evidenceIds = v1.l2.map(() => idFactory());
  const migrated: MemoryFileV2 = {
    schemaVersion: 2,
    l0: {
      ...v1.l0,
      fieldMetadata: metadataForProfile(v1.l0, [
        "preferredName", "occupation", "longTermInterests", "language", "permanentNotes",
      ], timestamp) as L0Profile["fieldMetadata"],
    },
    l1: {
      ...v1.l1,
      fieldMetadata: metadataForProfile(v1.l1, [
        "currentProject", "recentGoals", "recentPreferences",
      ], timestamp) as L1Profile["fieldMetadata"],
    },
    l2: v1.l2.map((memory, index) => ({
      id: memory.id,
      content: memory.content,
      confidence: memory.confidence,
      importance: memory.importance,
      evidenceIds: [evidenceIds[index]],
      createdAt: memory.createdAt,
      updatedAt: timestamp,
      lastAccessedAt: timestamp,
      accessCount: 0,
      weight: initialMemoryWeight(memory.importance, memory.confidence),
      isPinned: false,
      isEnabled: true,
      status: "active",
      syncStatus: "pending_sync",
      isSummary: false,
      sourceMemoryIds: [],
      sourceSnapshots: [],
      conflictWith: [],
    })),
    evidence: v1.l2.map((memory, index) => ({
      id: evidenceIds[index],
      memoryId: memory.id,
      quote: memory.evidence.userQuote,
      capturedAt: memory.evidence.capturedAt,
      source: "conversation",
      sourceMemoryIds: [],
    })),
    conflictLogs: [],
    reflectionLogs: [],
    auditLogs: [],
    maintenance: { successfulWritesSinceMaintenance: 0, running: false },
  };
  return validateMemoryFile(migrated);
}

function cloneMemoryFile(file: MemoryFile): MemoryFile {
  return structuredClone(file);
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function createSerialExecutor() {
  let tail = Promise.resolve();
  return function serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

export function defaultMemoryPath(homeDirectory = homedir()): string {
  return join(homeDirectory, ".cyrene-agent-replica-lab", "memory.json");
}

export function createMemoryStore(
  options: CreateMemoryStoreOptions = {},
): MemoryStore {
  const filePath = options.filePath ?? defaultMemoryPath();
  const atomicWrite = options.atomicWrite ?? writeFileAtomically;
  const now = options.now ?? Date.now;
  const idFactory = options.idFactory ?? randomUUID;
  const serializeUpdate = createSerialExecutor();
  let cache: MemoryFile | undefined;
  let initializationPromise: Promise<MemoryFile> | undefined;

  async function archiveCorruptFile(): Promise<MemoryFile> {
    const corruptPath = join(dirname(filePath), `memory.corrupt-${now()}.json`);
    await rename(filePath, corruptPath);
    return createEmptyMemoryFileV2();
  }

  async function loadFromDisk(): Promise<MemoryFile> {
    await recoverInterruptedAtomicWrite(filePath);
    let originalBytes: Buffer;
    try {
      originalBytes = await readFile(filePath);
    } catch (error) {
      if (isMissingFile(error)) return createEmptyMemoryFileV2();
      throw error;
    }

    let value: unknown;
    try {
      value = JSON.parse(originalBytes.toString("utf8")) as unknown;
    } catch {
      return archiveCorruptFile();
    }

    if (isRecord(value) && value.schemaVersion === 1) {
      try {
        const { migrateMemoryFileOnDisk } = await import("./memory-migrations.js");
        return await migrateMemoryFileOnDisk({
          filePath,
          now,
          idFactory,
          atomicWrite,
          originalBytes,
          value,
        });
      } catch (error) {
        if (isMemoryFileValidationError(error)) return archiveCorruptFile();
        throw error;
      }
    }

    try {
      return validateMemoryFile(value);
    } catch {
      return archiveCorruptFile();
    }
  }

  async function ensureCache(): Promise<MemoryFile> {
    if (cache) return cache;
    initializationPromise ??= loadFromDisk()
      .then((loaded) => {
        cache ??= cloneMemoryFile(loaded);
        return cache;
      })
      .finally(() => {
        initializationPromise = undefined;
      });
    return initializationPromise;
  }

  return {
    async load(): Promise<MemoryFile> {
      return cloneMemoryFile(await ensureCache());
    },

    update(mutator): Promise<MemoryFile> {
      return serializeUpdate(async () => {
        const draft = cloneMemoryFile(await ensureCache());
        mutator(draft);
        const validated = validateMemoryFile(draft);
        await atomicWrite(filePath, `${JSON.stringify(validated, null, 2)}\n`);
        cache = cloneMemoryFile(validated);
        return cloneMemoryFile(validated);
      });
    },
  };
}
