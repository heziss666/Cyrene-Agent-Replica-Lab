import { readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  recoverInterruptedAtomicWrite,
  writeFileAtomically,
} from "../rag/atomic-file-write.js";
import type {
  L0Profile,
  L1Profile,
  L2Memory,
  MemoryFile,
} from "./memory-types.js";

export interface MemoryStore {
  load(): Promise<MemoryFile>;
  update(mutator: (draft: MemoryFile) => void): Promise<MemoryFile>;
}

export interface CreateMemoryStoreOptions {
  filePath?: string;
  atomicWrite?: (filePath: string, content: string) => Promise<void>;
  now?: () => number;
}

function emptyMemoryFile(): MemoryFile {
  return {
    schemaVersion: 1,
    l0: { longTermInterests: [], permanentNotes: [] },
    l1: { recentGoals: [], recentPreferences: [] },
    l2: [],
  };
}

function cloneMemoryFile(file: MemoryFile): MemoryFile {
  return structuredClone(file);
}

function invalid(message: string): Error {
  return new Error(`Invalid memory file: ${message}`);
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)
  ) {
    throw invalid(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string") throw invalid(`${label} must be a string`);
  return value;
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw invalid(`${label} must be an array of strings`);
  }
  return [...value];
}

function assertOptionalString(
  value: unknown,
  label: string,
): string | undefined {
  return value === undefined ? undefined : assertString(value, label);
}

function validateL0Profile(value: unknown): L0Profile {
  const profile = assertPlainObject(value, "l0");
  const validated: L0Profile = {
    longTermInterests: assertStringArray(
      profile.longTermInterests,
      "l0.longTermInterests",
    ),
    permanentNotes: assertStringArray(profile.permanentNotes, "l0.permanentNotes"),
  };
  const preferredName = assertOptionalString(profile.preferredName, "l0.preferredName");
  const occupation = assertOptionalString(profile.occupation, "l0.occupation");
  const language = assertOptionalString(profile.language, "l0.language");
  const updatedAt = assertOptionalString(profile.updatedAt, "l0.updatedAt");
  if (preferredName !== undefined) validated.preferredName = preferredName;
  if (occupation !== undefined) validated.occupation = occupation;
  if (language !== undefined) validated.language = language;
  if (updatedAt !== undefined) validated.updatedAt = updatedAt;
  return validated;
}

function validateL1Profile(value: unknown): L1Profile {
  const profile = assertPlainObject(value, "l1");
  const validated: L1Profile = {
    recentGoals: assertStringArray(profile.recentGoals, "l1.recentGoals"),
    recentPreferences: assertStringArray(
      profile.recentPreferences,
      "l1.recentPreferences",
    ),
  };
  const currentProject = assertOptionalString(profile.currentProject, "l1.currentProject");
  const updatedAt = assertOptionalString(profile.updatedAt, "l1.updatedAt");
  if (currentProject !== undefined) validated.currentProject = currentProject;
  if (updatedAt !== undefined) validated.updatedAt = updatedAt;
  return validated;
}

function validateL2Memory(value: unknown, index: number): L2Memory {
  const memory = assertPlainObject(value, `l2[${index}]`);
  const confidence = memory.confidence;
  if (
    typeof confidence !== "number"
    || !Number.isFinite(confidence)
    || confidence < 0
    || confidence > 1
  ) {
    throw invalid(`l2[${index}].confidence must be a finite number between 0 and 1`);
  }
  if (memory.importance !== "medium" && memory.importance !== "high") {
    throw invalid(`l2[${index}].importance must be medium or high`);
  }
  if (memory.status !== "active") {
    throw invalid(`l2[${index}].status must be active`);
  }
  const evidence = assertPlainObject(memory.evidence, `l2[${index}].evidence`);
  return {
    id: assertString(memory.id, `l2[${index}].id`),
    content: assertString(memory.content, `l2[${index}].content`),
    confidence,
    importance: memory.importance,
    evidence: {
      userQuote: assertString(evidence.userQuote, `l2[${index}].evidence.userQuote`),
      capturedAt: assertString(evidence.capturedAt, `l2[${index}].evidence.capturedAt`),
    },
    createdAt: assertString(memory.createdAt, `l2[${index}].createdAt`),
    status: "active",
  };
}

export function validateMemoryFile(value: unknown): MemoryFile {
  const file = assertPlainObject(value, "file");
  if (file.schemaVersion !== 1) {
    throw invalid("schemaVersion must be 1");
  }
  if (!Array.isArray(file.l2)) throw invalid("l2 must be an array");
  return {
    schemaVersion: 1,
    l0: validateL0Profile(file.l0),
    l1: validateL1Profile(file.l1),
    l2: file.l2.map(validateL2Memory),
  };
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
  const serializeUpdate = createSerialExecutor();
  let cache: MemoryFile | undefined;
  let initializationPromise: Promise<MemoryFile> | undefined;

  async function archiveCorruptFile(): Promise<void> {
    const corruptPath = join(
      dirname(filePath),
      `memory.corrupt-${now()}.json`,
    );
    await rename(filePath, corruptPath);
  }

  async function loadFromDisk(): Promise<MemoryFile> {
    await recoverInterruptedAtomicWrite(filePath);
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return emptyMemoryFile();
      throw error;
    }

    try {
      return validateMemoryFile(JSON.parse(content) as unknown);
    } catch (error) {
      await archiveCorruptFile();
      return emptyMemoryFile();
    }
  }

  async function ensureCache(): Promise<MemoryFile> {
    if (cache) return cache;
    initializationPromise ??= loadFromDisk()
      .then((loaded) => {
        cache ??= loaded;
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
        cache = validated;
        return cloneMemoryFile(validated);
      });
    },
  };
}
