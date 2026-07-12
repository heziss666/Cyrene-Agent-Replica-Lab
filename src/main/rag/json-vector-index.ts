import { readFile, rm } from "node:fs/promises";
import { writeFileAtomically } from "./atomic-file-write.js";
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

export interface CreateJsonVectorIndexOptions {
  filePath: string;
  identity: VectorIndexIdentity;
  chunkSizeChars: number;
  overlapChars: number;
  logger?: (message: string) => void;
}

function cloneEntry(entry: VectorIndexEntry): VectorIndexEntry {
  return { ...entry, vector: [...entry.vector] };
}

function invalid(message: string): Error {
  return new Error(`Invalid vector index: ${message}`);
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string") throw invalid(`${label} must be a string`);
  return value;
}

function assertPositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throw invalid(`${label} must be a positive integer`);
  }
  return value;
}

function assertNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw invalid(`${label} must be a non-negative integer`);
  }
  return value;
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

function assertEntry(value: unknown, label: string): VectorIndexEntry {
  const entry = assertPlainObject(value, label);
  return {
    chunkId: assertString(entry.chunkId, `${label}.chunkId`),
    textHash: assertString(entry.textHash, `${label}.textHash`),
    vector: assertVector(entry.vector, `${label}.vector`),
  };
}

function assertEntryArray(value: unknown): VectorIndexEntry[] {
  if (!Array.isArray(value)) throw invalid("entries must be an array");

  const chunkIds = new Set<string>();
  return value.map((entry, index) => {
    const parsed = assertEntry(entry, `entries[${index}]`);
    if (chunkIds.has(parsed.chunkId)) {
      throw invalid(`duplicate chunkId: ${parsed.chunkId}`);
    }
    chunkIds.add(parsed.chunkId);
    return parsed;
  });
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function createJsonVectorIndex(options: CreateJsonVectorIndexOptions): VectorIndex {
  const entries = new Map<string, VectorIndexEntry>();
  const logger = options.logger ?? console.log;
  let dimensions: number | undefined;
  let initializationPromise: Promise<VectorIndexLoadResult> | undefined;

  function validateDimensions(entriesToValidate: VectorIndexEntry[], expectedDimensions: number): void {
    for (const entry of entriesToValidate) {
      if (entry.vector.length !== expectedDimensions) {
        throw invalid(
          `vector dimensions must match embedding.dimensions: expected ${expectedDimensions}, received ${entry.vector.length}`,
        );
      }
    }
  }

  function parseFile(value: unknown): VectorIndexFile {
    const file = assertPlainObject(value, "file");
    const schemaVersion = assertPositiveInteger(file.schemaVersion, "schemaVersion");
    if (schemaVersion !== options.identity.schemaVersion) {
      throw invalid(`schemaVersion must match ${options.identity.schemaVersion}`);
    }

    const embedding = assertPlainObject(file.embedding, "embedding");
    const providerId = assertString(embedding.providerId, "embedding.providerId");
    const model = assertString(embedding.model, "embedding.model");
    const fileDimensions = assertPositiveInteger(embedding.dimensions, "embedding.dimensions");
    if (providerId !== options.identity.providerId || model !== options.identity.model) {
      throw invalid("embedding identity does not match");
    }

    const chunking = assertPlainObject(file.chunking, "chunking");
    const chunkSizeChars = assertPositiveInteger(chunking.chunkSizeChars, "chunking.chunkSizeChars");
    const overlapChars = assertNonNegativeInteger(chunking.overlapChars, "chunking.overlapChars");
    if (
      chunkSizeChars !== options.chunkSizeChars ||
      overlapChars !== options.overlapChars
    ) {
      throw invalid("chunking configuration does not match");
    }

    const fileEntries = assertEntryArray(file.entries);
    validateDimensions(fileEntries, fileDimensions);
    return {
      schemaVersion: VECTOR_INDEX_SCHEMA_VERSION,
      embedding: { providerId, model, dimensions: fileDimensions },
      chunking: { chunkSizeChars, overlapChars },
      entries: fileEntries,
    };
  }

  async function load(): Promise<VectorIndexLoadResult> {
    let content: string;
    try {
      content = await readFile(options.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) {
        logger("[RAG] vector index missing");
        return { status: "missing", loadedEntries: 0 };
      }
      throw error;
    }

    const file = parseFile(JSON.parse(content));
    dimensions = file.embedding.dimensions;
    for (const entry of file.entries) entries.set(entry.chunkId, cloneEntry(entry));
    logger(`[RAG] vector index loaded: ${entries.size} entries`);
    return { status: "loaded", loadedEntries: entries.size };
  }

  function initialize(): Promise<VectorIndexLoadResult> {
    initializationPromise ??= load();
    return initializationPromise;
  }

  async function save(): Promise<void> {
    if (dimensions === undefined) {
      throw invalid("embedding.dimensions must be set before saving");
    }

    const file: VectorIndexFile = {
      schemaVersion: VECTOR_INDEX_SCHEMA_VERSION,
      embedding: {
        providerId: options.identity.providerId,
        model: options.identity.model,
        dimensions,
      },
      chunking: {
        chunkSizeChars: options.chunkSizeChars,
        overlapChars: options.overlapChars,
      },
      entries: [...entries.values()].map(cloneEntry),
    };
    await writeFileAtomically(options.filePath, `${JSON.stringify(file, null, 2)}\n`);
    logger(`[RAG] vector index saved: ${entries.size} entries`);
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

    async addMany(nextEntries) {
      await initialize();
      const parsedEntries = assertEntryArray(nextEntries);
      if (parsedEntries.length === 0) return;

      const nextDimensions = dimensions ?? parsedEntries[0].vector.length;
      validateDimensions(parsedEntries, nextDimensions);
      for (const entry of parsedEntries) entries.set(entry.chunkId, cloneEntry(entry));
      dimensions = nextDimensions;
      await save();
    },

    async prune(validEntries: VectorIndexEntryKey[]) {
      await initialize();
      const valid = new Map(validEntries.map((entry) => [entry.chunkId, entry.textHash]));
      let removed = 0;
      for (const [chunkId, entry] of entries) {
        if (valid.get(chunkId) !== entry.textHash) {
          entries.delete(chunkId);
          removed += 1;
        }
      }
      if (removed > 0) await save();
      return removed;
    },

    async clear() {
      await initialize();
      entries.clear();
      dimensions = undefined;
      await Promise.all([
        rm(options.filePath, { force: true }),
        rm(`${options.filePath}.tmp`, { force: true }),
        rm(`${options.filePath}.bak`, { force: true }),
      ]);
    },
  };
}
