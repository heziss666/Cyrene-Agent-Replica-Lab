import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface AtomicFileOperations {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  writeFile(path: string, content: string, encoding: "utf8"): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
}

const defaultFileOperations: AtomicFileOperations = {
  mkdir: (path, options) => mkdir(path, options),
  writeFile: (path, content, encoding) => writeFile(path, content, encoding),
  rename: (oldPath, newPath) => rename(oldPath, newPath),
  rm: (path, options) => rm(path, options),
};

async function bestEffortRemove(
  path: string,
  fileOps: Pick<AtomicFileOperations, "rm"> = defaultFileOperations,
): Promise<void> {
  try {
    await fileOps.rm(path, { force: true });
  } catch {
    // A later startup pass can remove stale artifacts.
  }
}

async function retireBackup(
  backupPath: string,
  fileOps: Pick<AtomicFileOperations, "rm"> = defaultFileOperations,
): Promise<void> {
  try {
    await fileOps.rm(backupPath, { force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to retire stale backup ${backupPath}: ${message}`,
      { cause: error },
    );
  }
}

export async function writeFileAtomically(
  filePath: string,
  content: string,
  fileOps: AtomicFileOperations = defaultFileOperations,
): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}-${randomUUID()}.tmp`;
  const backupPath = `${filePath}.bak`;

  await fileOps.mkdir(dirname(filePath), { recursive: true });
  try {
    await fileOps.writeFile(temporaryPath, content, "utf8");
  } catch (error) {
    await bestEffortRemove(temporaryPath, fileOps);
    throw error;
  }

  try {
    await fileOps.rename(temporaryPath, filePath);
    return;
  } catch (error) {
    if (!isReplacementError(error)) {
      await bestEffortRemove(temporaryPath, fileOps);
      throw error;
    }
  }

  try {
    await retireBackup(backupPath, fileOps);
  } catch (error) {
    await bestEffortRemove(temporaryPath, fileOps);
    throw error;
  }

  try {
    await fileOps.rename(filePath, backupPath);
  } catch (error) {
    await bestEffortRemove(temporaryPath, fileOps);
    throw error;
  }

  try {
    await fileOps.rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await fileOps.rename(backupPath, filePath);
    } catch {
      // Preserve the replacement error; the backup remains recoverable at startup.
    }
    await bestEffortRemove(temporaryPath, fileOps);
    throw error;
  }

  await bestEffortRemove(backupPath, fileOps);
  await bestEffortRemove(temporaryPath, fileOps);
}

export async function recoverInterruptedAtomicWrite(
  filePath: string,
): Promise<void> {
  try {
    await access(filePath);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    try {
      await rename(`${filePath}.bak`, filePath);
    } catch (backupError) {
      if (!isMissingFile(backupError)) throw backupError;
    }
  }

  await removeAtomicTemporaryFiles(filePath);
}

export async function removeStaleAtomicBackup(filePath: string): Promise<void> {
  await retireBackup(`${filePath}.bak`);
}

export async function removeAtomicTemporaryFiles(filePath: string): Promise<void> {
  const directory = dirname(filePath);
  const fileName = basename(filePath);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (isMissingFile(error)) return;
    return;
  }

  await Promise.all(
    names
      .filter((name) =>
        name === `${fileName}.tmp` ||
        (name.startsWith(`${fileName}.`) && name.endsWith(".tmp")),
      )
      .map((name) => bestEffortRemove(join(directory, name))),
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

function isReplacementError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return (
    error.code === "EPERM" ||
    error.code === "EACCES" ||
    error.code === "EEXIST"
  );
}
