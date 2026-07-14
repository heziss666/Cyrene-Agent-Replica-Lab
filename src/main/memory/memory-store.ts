import { randomUUID } from "node:crypto";
import { readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  recoverInterruptedAtomicWrite,
  writeFileAtomically,
} from "../rag/atomic-file-write.js";
import {
  isMemoryFileValidationError,
  migrateMemoryFileOnDisk,
  validateMemoryFileV2,
} from "./memory-migrations.js";
import { createEmptyMemoryFileV2, type MemoryFile } from "./memory-types.js";

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

function cloneMemoryFile(file: MemoryFile): MemoryFile {
  return structuredClone(file);
}

export function validateMemoryFile(value: unknown): MemoryFile {
  return validateMemoryFileV2(value);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOENT";
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

    if (typeof value === "object"
      && value !== null
      && "schemaVersion" in value
      && value.schemaVersion === 1) {
      try {
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
      return validateMemoryFileV2(value);
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
        const validated = validateMemoryFileV2(draft);
        await atomicWrite(filePath, `${JSON.stringify(validated, null, 2)}\n`);
        cache = cloneMemoryFile(validated);
        return cloneMemoryFile(validated);
      });
    },
  };
}
