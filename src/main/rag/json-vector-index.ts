import { readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  recoverInterruptedAtomicWrite,
  removeAtomicTemporaryFiles,
  removeStaleAtomicBackup,
  writeFileAtomically,
} from "./atomic-file-write.js";
import { validateVector } from "./vector-math.js";
import {
  VECTOR_INDEX_SCHEMA_VERSION,
  type VectorIndex,
  type VectorIndexEntry,
  type VectorIndexEntryKey,
  type VectorIndexFile,
  type VectorIndexIdentity,
  type VectorIndexLoadResult,
} from "./vector-index-types.js";

type AtomicWrite = (filePath: string, content: string) => Promise<void>;

export interface CreateJsonVectorIndexOptions {
  filePath: string;
  identity: VectorIndexIdentity;
  chunkSizeChars: number;
  overlapChars: number;
  logger?: (message: string) => void;
  atomicWrite?: AtomicWrite;
}

function cloneEntry(entry: VectorIndexEntry): VectorIndexEntry {
  return { ...entry, vector: [...entry.vector] };
}

function cloneEntries(
  entries: ReadonlyMap<string, VectorIndexEntry>,
): Map<string, VectorIndexEntry> {
  return new Map(
    [...entries].map(([chunkId, entry]) => [chunkId, cloneEntry(entry)]),
  );
}

function invalid(message: string): Error {
  return new Error(`Invalid vector index: ${message}`);
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw invalid(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string") throw invalid(`${label} must be a string`);
  return value;
}

function assertNonEmptyString(value: unknown, label: string): string {
  const parsed = assertString(value, label);
  if (parsed.trim().length === 0) {
    throw invalid(`${label} must be a non-empty string`);
  }
  return parsed;
}

function assertTextHash(value: unknown, label: string): string {
  const parsed = assertString(value, label);
  if (!/^[0-9a-f]{64}$/.test(parsed)) {
    throw invalid(`${label} must be exactly 64 lowercase hex characters`);
  }
  return parsed;
}

function assertPositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throw invalid(`${label} must be a positive integer`);
  }
  return value;
}

function assertInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || typeof value !== "number") {
    throw invalid(`${label} must be an integer`);
  }
  return value;
}

function assertNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw invalid(`${label} must be a non-negative integer`);
  }
  return value;
}

function assertChunking(
  chunkSizeValue: unknown,
  overlapValue: unknown,
  prefix = "chunking.",
): { chunkSizeChars: number; overlapChars: number } {
  const chunkSizeChars = assertPositiveInteger(
    chunkSizeValue,
    `${prefix}chunkSizeChars`,
  );
  const overlapChars = assertNonNegativeInteger(
    overlapValue,
    `${prefix}overlapChars`,
  );
  if (overlapChars >= chunkSizeChars) {
    throw invalid(`${prefix}overlapChars must be smaller than chunkSizeChars`);
  }
  return { chunkSizeChars, overlapChars };
}

function assertVector(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) throw invalid(`${label} must be an array`);
  if (!value.every((item) => typeof item === "number")) {
    throw invalid(`${label} must contain only numbers`);
  }

  const vector = value as number[];
  validateVector(vector, `Invalid vector index: ${label}`);
  return vector;
}

function assertEntryKey(value: unknown, label: string): VectorIndexEntryKey {
  const entry = assertPlainObject(value, label);
  return {
    chunkId: assertNonEmptyString(entry.chunkId, `${label}.chunkId`),
    textHash: assertTextHash(entry.textHash, `${label}.textHash`),
  };
}

function assertEntry(value: unknown, label: string): VectorIndexEntry {
  const entry = assertPlainObject(value, label);
  return {
    chunkId: assertNonEmptyString(entry.chunkId, `${label}.chunkId`),
    textHash: assertTextHash(entry.textHash, `${label}.textHash`),
    vector: assertVector(entry.vector, `${label}.vector`),
  };
}

function assertUniqueChunkIds<T extends VectorIndexEntryKey>(
  entries: T[],
): T[] {
  const chunkIds = new Set<string>();
  for (const entry of entries) {
    if (chunkIds.has(entry.chunkId)) {
      throw invalid(`duplicate chunkId: ${entry.chunkId}`);
    }
    chunkIds.add(entry.chunkId);
  }
  return entries;
}

function assertEntryArray(value: unknown): VectorIndexEntry[] {
  if (!Array.isArray(value)) throw invalid("entries must be an array");
  return assertUniqueChunkIds(
    Array.from(value, (entry, index) => assertEntry(entry, `entries[${index}]`)),
  );
}

function assertEntryKeyArray(value: unknown): VectorIndexEntryKey[] {
  if (!Array.isArray(value)) throw invalid("validEntries must be an array");
  return assertUniqueChunkIds(
    Array.from(value, (entry, index) =>
      assertEntryKey(entry, `validEntries[${index}]`),
    ),
  );
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateDimensions(
  entriesToValidate: VectorIndexEntry[],
  expectedDimensions: number,
): void {
  for (const entry of entriesToValidate) {
    if (entry.vector.length !== expectedDimensions) {
      throw invalid(
        `vector dimensions must match embedding.dimensions: expected ${expectedDimensions}, received ${entry.vector.length}`,
      );
    }
  }
}

export function validateVectorIndexFile(value: unknown): VectorIndexFile {
  const file = assertPlainObject(value, "file");
  const schemaVersion = assertPositiveInteger(file.schemaVersion, "schemaVersion");
  if (schemaVersion !== VECTOR_INDEX_SCHEMA_VERSION) {
    throw invalid(`schemaVersion must match ${VECTOR_INDEX_SCHEMA_VERSION}`);
  }

  const embedding = assertPlainObject(file.embedding, "embedding");
  const providerId = assertNonEmptyString(
    embedding.providerId,
    "embedding.providerId",
  );
  const model = assertNonEmptyString(embedding.model, "embedding.model");
  const dimensions = assertPositiveInteger(
    embedding.dimensions,
    "embedding.dimensions",
  );

  const chunking = assertPlainObject(file.chunking, "chunking");
  const { chunkSizeChars, overlapChars } = assertChunking(
    chunking.chunkSizeChars,
    chunking.overlapChars,
  );

  const entries = assertEntryArray(file.entries);
  validateDimensions(entries, dimensions);
  return {
    schemaVersion: VECTOR_INDEX_SCHEMA_VERSION,
    embedding: { providerId, model, dimensions },
    chunking: { chunkSizeChars, overlapChars },
    entries,
  };
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

export function createJsonVectorIndex(options: CreateJsonVectorIndexOptions): VectorIndex {
  assertNonEmptyString(options.identity.providerId, "identity.providerId");
  assertNonEmptyString(options.identity.model, "identity.model");
  if (options.identity.schemaVersion !== VECTOR_INDEX_SCHEMA_VERSION) {
    throw invalid(
      `identity.schemaVersion must match ${VECTOR_INDEX_SCHEMA_VERSION}`,
    );
  }
  assertChunking(options.chunkSizeChars, options.overlapChars, "");

  // Mutations are serialized within this index instance. Coordinating simultaneous
  // writers in separate processes remains outside this JSON implementation's scope.
  const serializeMutation = createSerialExecutor();
  const logger = options.logger ?? console.log;
  const atomicWrite = options.atomicWrite ?? writeFileAtomically;
  let entries = new Map<string, VectorIndexEntry>();
  let dimensions: number | undefined;
  let initializationPromise: Promise<VectorIndexLoadResult> | undefined;

  function log(message: string): void {
    try {
      logger(message);
    } catch {
      // Observability must never alter index state or persistence outcomes.
    }
  }

  function incompatible(warning: string): VectorIndexLoadResult {
    log(`[RAG] ${warning}`);
    return { status: "incompatible", loadedEntries: 0, warning };
  }

  function getCompatibilityWarning(file: VectorIndexFile): string | undefined {
    if (file.embedding.providerId !== options.identity.providerId) {
      return `Vector index incompatible: provider changed from ${file.embedding.providerId} to ${options.identity.providerId}`;
    }
    if (file.embedding.model !== options.identity.model) {
      return `Vector index incompatible: model changed from ${file.embedding.model} to ${options.identity.model}`;
    }
    if (file.chunking.chunkSizeChars !== options.chunkSizeChars) {
      return `Vector index incompatible: chunkSizeChars changed from ${file.chunking.chunkSizeChars} to ${options.chunkSizeChars}`;
    }
    if (file.chunking.overlapChars !== options.overlapChars) {
      return `Vector index incompatible: overlapChars changed from ${file.chunking.overlapChars} to ${options.overlapChars}`;
    }
    return undefined;
  }

  type IndexCandidate =
    | { kind: "loaded"; file: VectorIndexFile }
    | { kind: "incompatible"; warning: string };

  function inspectContent(content: string): IndexCandidate {
    const parsed: unknown = JSON.parse(content);
    const persisted = assertPlainObject(parsed, "file");
    const schemaVersion = assertInteger(persisted.schemaVersion, "schemaVersion");
    if (schemaVersion !== VECTOR_INDEX_SCHEMA_VERSION) {
      return {
        kind: "incompatible",
        warning: `Vector index incompatible: schemaVersion changed from ${schemaVersion} to ${VECTOR_INDEX_SCHEMA_VERSION}`,
      };
    }

    const file = validateVectorIndexFile(parsed);
    const warning = getCompatibilityWarning(file);
    return warning
      ? { kind: "incompatible", warning }
      : { kind: "loaded", file };
  }

  function useCandidate(candidate: IndexCandidate): VectorIndexLoadResult {
    if (candidate.kind === "incompatible") {
      return incompatible(candidate.warning);
    }

    entries = new Map(
      candidate.file.entries.map((entry) => [entry.chunkId, cloneEntry(entry)]),
    );
    dimensions = entries.size > 0
      ? candidate.file.embedding.dimensions
      : undefined;
    log(`[RAG] vector index loaded: ${entries.size} entries`);
    return { status: "loaded", loadedEntries: entries.size };
  }

  function corruptPath(): string {
    return join(
      dirname(options.filePath),
      `vector-index.corrupt-${Date.now()}.json`,
    );
  }

  async function recoverCorruptFile(error: unknown): Promise<VectorIndexLoadResult> {
    const backupPath = corruptPath();
    await rename(options.filePath, backupPath);
    const warning = `Vector index corrupt: ${errorMessage(error)}; backup created at ${backupPath}`;
    log(`[RAG] ${warning}`);
    return { status: "corrupt", loadedEntries: 0, warning };
  }

  async function readBackupCandidate(): Promise<IndexCandidate | undefined> {
    let backupContent: string;
    try {
      backupContent = await readFile(`${options.filePath}.bak`, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }

    try {
      return inspectContent(backupContent);
    } catch {
      await removeStaleAtomicBackup(options.filePath);
      return undefined;
    }
  }

  async function restoreBackup(
    candidate: IndexCandidate,
    formalError: unknown,
  ): Promise<VectorIndexLoadResult> {
    const archivedFormalPath = corruptPath();
    await rename(options.filePath, archivedFormalPath);
    try {
      await rename(`${options.filePath}.bak`, options.filePath);
    } catch (error) {
      try {
        await rename(archivedFormalPath, options.filePath);
      } catch {
        // Preserve the backup promotion error; startup can retry either artifact.
      }
      throw error;
    }

    log(
      `[RAG] corrupt formal index archived at ${archivedFormalPath}; valid backup restored: ${errorMessage(formalError)}`,
    );
    return useCandidate(candidate);
  }

  async function load(): Promise<VectorIndexLoadResult> {
    await recoverInterruptedAtomicWrite(options.filePath);

    let content: string;
    try {
      content = await readFile(options.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) {
        log("[RAG] vector index missing");
        return { status: "missing", loadedEntries: 0 };
      }
      throw error;
    }

    let candidate: IndexCandidate;
    try {
      candidate = inspectContent(content);
    } catch (error) {
      const backupCandidate = await readBackupCandidate();
      if (backupCandidate) {
        return restoreBackup(backupCandidate, error);
      }
      return recoverCorruptFile(error);
    }

    await removeStaleAtomicBackup(options.filePath);
    return useCandidate(candidate);
  }

  function initialize(): Promise<VectorIndexLoadResult> {
    initializationPromise ??= load();
    return initializationPromise;
  }

  async function save(
    nextEntries: ReadonlyMap<string, VectorIndexEntry>,
    nextDimensions: number,
  ): Promise<void> {
    const file: VectorIndexFile = {
      schemaVersion: VECTOR_INDEX_SCHEMA_VERSION,
      embedding: {
        providerId: options.identity.providerId,
        model: options.identity.model,
        dimensions: nextDimensions,
      },
      chunking: {
        chunkSizeChars: options.chunkSizeChars,
        overlapChars: options.overlapChars,
      },
      entries: [...nextEntries.values()].map(cloneEntry),
    };
    await atomicWrite(options.filePath, `${JSON.stringify(file, null, 2)}\n`);
    log(`[RAG] vector index saved: ${nextEntries.size} entries`);
  }

  async function removePersistedIndex(): Promise<void> {
    await rm(`${options.filePath}.bak`, { force: true });
    await rm(options.filePath, { force: true });
    await removeAtomicTemporaryFiles(options.filePath);
  }

  return {
    initialize,

    has(chunkId, textHash) {
      return entries.get(chunkId)?.textHash === textHash;
    },

    get(chunkId, textHash) {
      const entry = entries.get(chunkId);
      return entry?.textHash === textHash ? [...entry.vector] : undefined;
    },

    addMany(nextEntries) {
      return serializeMutation(async () => {
        await initialize();
        const parsedEntries = assertEntryArray(nextEntries);
        if (parsedEntries.length === 0) return;

        const nextDimensions = dimensions ?? parsedEntries[0].vector.length;
        validateDimensions(parsedEntries, nextDimensions);
        const stagedEntries = cloneEntries(entries);
        for (const entry of parsedEntries) {
          stagedEntries.set(entry.chunkId, cloneEntry(entry));
        }

        await save(stagedEntries, nextDimensions);
        entries = stagedEntries;
        dimensions = nextDimensions;
      });
    },

    prune(validEntries) {
      return serializeMutation(async () => {
        await initialize();
        const parsedValidEntries = assertEntryKeyArray(validEntries);
        const valid = new Map(
          parsedValidEntries.map((entry) => [entry.chunkId, entry.textHash]),
        );
        const stagedEntries = cloneEntries(entries);
        let removed = 0;
        for (const [chunkId, entry] of stagedEntries) {
          if (valid.get(chunkId) !== entry.textHash) {
            stagedEntries.delete(chunkId);
            removed += 1;
          }
        }
        if (removed === 0) return 0;

        const nextDimensions = stagedEntries.size === 0 ? undefined : dimensions;
        const persistedDimensions = nextDimensions ?? dimensions;
        if (persistedDimensions === undefined) {
          throw invalid("embedding.dimensions must be set before pruning");
        }
        await save(stagedEntries, persistedDimensions);
        entries = stagedEntries;
        dimensions = nextDimensions;
        return removed;
      });
    },

    clear() {
      return serializeMutation(async () => {
        await initialize();
        await removePersistedIndex();
        entries = new Map();
        dimensions = undefined;
      });
    },
  };
}
