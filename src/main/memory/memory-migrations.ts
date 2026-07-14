import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  recoverInterruptedAtomicWrite,
  writeFileAtomically,
} from "../rag/atomic-file-write.js";
import {
  migrateMemoryFileForMigration,
  validateMemoryFile,
} from "./memory-store.js";
import type { MemoryFileV2 } from "./memory-types.js";

type AtomicWrite = (filePath: string, content: string) => Promise<void>;

export interface MigrationBackupFileOperations {
  writeFile(
    path: string,
    content: Buffer,
    options: { flag: "wx" },
  ): Promise<void>;
  readFile(path: string): Promise<Buffer>;
}

export interface MigrateMemoryFileOnDiskOptions {
  filePath: string;
  now?: () => number;
  idFactory?: () => string;
  atomicWrite?: AtomicWrite;
  backupFileOperations?: MigrationBackupFileOperations;
  originalBytes?: Buffer;
  value?: unknown;
}

const defaultBackupFileOperations: MigrationBackupFileOperations = {
  writeFile: (path, content, options) => writeFile(path, content, options),
  readFile: (path) => readFile(path),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExclusiveCreateCollision(error: unknown): boolean {
  return isRecord(error) && error.code === "EEXIST";
}

export function migrateMemoryFile(
  value: unknown,
  now: () => number,
  idFactory: () => string,
): MemoryFileV2 {
  return migrateMemoryFileForMigration(value, now, idFactory);
}

async function createMigrationBackup(
  backupPath: string,
  originalBytes: Buffer,
  fileOperations: MigrationBackupFileOperations,
): Promise<void> {
  try {
    await fileOperations.writeFile(backupPath, originalBytes, { flag: "wx" });
  } catch (error) {
    if (!isExclusiveCreateCollision(error)) throw error;
    let existingBytes: Buffer;
    try {
      existingBytes = await fileOperations.readFile(backupPath);
    } catch (readError) {
      throw new Error(`Existing migration backup cannot be verified: ${backupPath}`, {
        cause: readError,
      });
    }
    if (!existingBytes.equals(originalBytes)) {
      throw new Error(`Existing migration backup has different bytes: ${backupPath}`);
    }
  }
}

export async function migrateMemoryFileOnDisk(
  options: MigrateMemoryFileOnDiskOptions,
): Promise<MemoryFileV2> {
  const now = options.now ?? Date.now;
  const idFactory = options.idFactory ?? randomUUID;
  const atomicWrite = options.atomicWrite ?? writeFileAtomically;
  const backupFileOperations = options.backupFileOperations
    ?? defaultBackupFileOperations;
  if (options.originalBytes === undefined || options.value === undefined) {
    await recoverInterruptedAtomicWrite(options.filePath);
  }
  const originalBytes = options.originalBytes ?? await readFile(options.filePath);
  const value = options.value ?? JSON.parse(originalBytes.toString("utf8")) as unknown;

  if (isRecord(value) && value.schemaVersion === 2) {
    return validateMemoryFile(value);
  }

  const migrationTime = now();
  const migrated = migrateMemoryFile(value, () => migrationTime, idFactory);
  const backupPath = join(
    dirname(options.filePath),
    `memory.pre-v2-${migrationTime}.json`,
  );
  await createMigrationBackup(backupPath, originalBytes, backupFileOperations);
  await atomicWrite(options.filePath, `${JSON.stringify(migrated, null, 2)}\n`);
  return structuredClone(migrated);
}
