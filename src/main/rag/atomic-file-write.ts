import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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

export async function writeFileAtomically(
  filePath: string,
  content: string,
  fileOps: AtomicFileOperations = defaultFileOperations,
): Promise<void> {
  const temporaryPath = `${filePath}.tmp`;
  const backupPath = `${filePath}.bak`;

  await fileOps.mkdir(dirname(filePath), { recursive: true });
  try {
    await fileOps.writeFile(temporaryPath, content, "utf8");
  } catch (error) {
    await fileOps.rm(temporaryPath, { force: true });
    throw error;
  }

  try {
    await fileOps.rename(temporaryPath, filePath);
    return;
  } catch (error) {
    if (!isReplacementError(error)) {
      await fileOps.rm(temporaryPath, { force: true });
      throw error;
    }
  }

  try {
    await fileOps.rename(filePath, backupPath);
    try {
      await fileOps.rename(temporaryPath, filePath);
    } catch (error) {
      await fileOps.rename(backupPath, filePath);
      throw error;
    }
    await fileOps.rm(backupPath, { force: true });
  } finally {
    await fileOps.rm(temporaryPath, { force: true });
  }
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
