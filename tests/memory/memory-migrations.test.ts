import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recoverInterruptedAtomicWrite,
  writeFileAtomically,
  type AtomicFileOperations,
} from "../../src/main/rag/atomic-file-write.js";
import {
  migrateMemoryFile,
  migrateMemoryFileOnDisk,
} from "../../src/main/memory/memory-migrations.js";
import { createEmptyMemoryFileV2 } from "../../src/main/memory/memory-types.js";

const NOW = 1_720_944_000_000;
const TIMESTAMP = "2024-07-14T08:00:00.000Z";
const directories: string[] = [];

const v1File = {
  schemaVersion: 1 as const,
  l0: {
    preferredName: "Alex",
    longTermInterests: ["TypeScript"],
    permanentNotes: [],
    updatedAt: "2024-07-01T00:00:00.000Z",
  },
  l1: {
    currentProject: "Cyrene",
    recentGoals: [],
    recentPreferences: [],
  },
  l2: [{
    id: "memory-1",
    content: "Completed Phase 7A",
    confidence: 0.9,
    importance: "high" as const,
    evidence: {
      userQuote: "I completed Phase 7A",
      capturedAt: "2024-07-13T12:00:00.000Z",
    },
    createdAt: "2024-07-13T12:00:00.000Z",
    status: "active" as const,
  }],
};

async function createFilePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cyrene-memory-migration-"));
  directories.push(directory);
  return join(directory, "memory.json");
}

const now = () => NOW;
const idFactory = () => "evidence-1";

function fileSystemError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("migrateMemoryFile", () => {
  it("moves embedded v1 evidence into one separate v2 Evidence record", () => {
    const migrated = migrateMemoryFile(v1File, now, idFactory);

    expect(migrated.l2[0]?.evidenceIds).toEqual(["evidence-1"]);
    expect(migrated.evidence).toEqual([{
      id: "evidence-1",
      memoryId: "memory-1",
      quote: "I completed Phase 7A",
      capturedAt: "2024-07-13T12:00:00.000Z",
      source: "conversation",
      sourceMemoryIds: [],
    }]);
  });

  it("adds lifecycle, sync, linkage, profile metadata, and container defaults", () => {
    const migrated = migrateMemoryFile(v1File, now, idFactory);

    expect(migrated).toMatchObject({
      schemaVersion: 2,
      l0: {
        fieldMetadata: {
          preferredName: {
            updatedAt: "2024-07-01T00:00:00.000Z",
            source: "judge",
          },
          longTermInterests: {
            updatedAt: "2024-07-01T00:00:00.000Z",
            source: "judge",
          },
        },
      },
      l1: {
        fieldMetadata: {
          currentProject: { updatedAt: TIMESTAMP, source: "judge" },
        },
      },
      conflictLogs: [],
      reflectionLogs: [],
      auditLogs: [],
      maintenance: { successfulWritesSinceMaintenance: 0, running: false },
    });
    expect(migrated.l2[0]).toEqual({
      id: "memory-1",
      content: "Completed Phase 7A",
      confidence: 0.9,
      importance: "high",
      evidenceIds: ["evidence-1"],
      createdAt: "2024-07-13T12:00:00.000Z",
      updatedAt: TIMESTAMP,
      lastAccessedAt: TIMESTAMP,
      accessCount: 0,
      weight: 0.765,
      isPinned: false,
      isEnabled: true,
      status: "active",
      syncStatus: "pending_sync",
      isSummary: false,
      sourceMemoryIds: [],
      sourceSnapshots: [],
      conflictWith: [],
    });
  });

  it("clones existing v2 input without changing it", () => {
    const v2 = {
      ...createEmptyMemoryFileV2(),
      extension: { provider: "future-runtime", revision: 3 },
    };
    const migrated = migrateMemoryFile(v2, now, idFactory);

    expect(migrated).toEqual(v2);
    expect(migrated).not.toBe(v2);
    expect(migrated.l0).not.toBe(v2.l0);
  });
});

describe("migrateMemoryFileOnDisk", () => {
  it("creates a deterministic byte-for-byte v1 backup before replacement", async () => {
    const filePath = await createFilePath();
    const original = `  ${JSON.stringify(v1File, null, 2)}\r\n`;
    await writeFile(filePath, original, "utf8");

    const migrated = await migrateMemoryFileOnDisk({ filePath, now, idFactory });

    expect(migrated.schemaVersion).toBe(2);
    expect(await readFile(join(filePath, `../memory.pre-v2-${NOW}.json`), "utf8"))
      .toBe(original);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(migrated);
  });

  it("does not create a backup for an existing v2 file", async () => {
    const filePath = await createFilePath();
    const v2 = {
      ...createEmptyMemoryFileV2(),
      extension: { provider: "future-runtime", revision: 3 },
    };
    await writeFile(filePath, JSON.stringify(v2), "utf8");

    const loaded = await migrateMemoryFileOnDisk({ filePath, now, idFactory });

    expect(loaded).toEqual(v2);
    expect(loaded).not.toBe(v2);
    expect(await readdir(join(filePath, ".."))).toEqual(["memory.json"]);
  });

  it("leaves v1 readable when exclusive backup creation itself fails", async () => {
    const filePath = await createFilePath();
    const original = JSON.stringify(v1File);
    const backupWrite = vi.fn(async () => {
      throw new Error("backup device unavailable");
    });
    await writeFile(filePath, original, "utf8");

    await expect(migrateMemoryFileOnDisk({
      filePath,
      now,
      idFactory,
      backupFileOperations: {
        writeFile: backupWrite,
        readFile,
      },
    })).rejects.toThrow("backup device unavailable");

    expect(backupWrite).toHaveBeenCalledWith(
      join(filePath, `../memory.pre-v2-${NOW}.json`),
      Buffer.from(original),
      { flag: "wx" },
    );
    expect(await readFile(filePath, "utf8")).toBe(original);
  });

  it("leaves v1 readable when an existing backup has different bytes", async () => {
    const filePath = await createFilePath();
    const original = JSON.stringify(v1File);
    const backupPath = join(filePath, `../memory.pre-v2-${NOW}.json`);
    await writeFile(filePath, original, "utf8");
    await writeFile(backupPath, "different bytes", "utf8");

    await expect(migrateMemoryFileOnDisk({ filePath, now, idFactory }))
      .rejects.toThrow("different bytes");
    expect(await readFile(filePath, "utf8")).toBe(original);
  });

  it("leaves v1 readable when atomic replacement fails", async () => {
    const filePath = await createFilePath();
    const original = JSON.stringify(v1File);
    await writeFile(filePath, original, "utf8");

    await expect(migrateMemoryFileOnDisk({
      filePath,
      now,
      idFactory,
      atomicWrite: vi.fn(async () => {
        throw new Error("replacement failed");
      }),
    })).rejects.toThrow("replacement failed");
    expect(await readFile(filePath, "utf8")).toBe(original);
    expect(await readFile(join(filePath, `../memory.pre-v2-${NOW}.json`), "utf8"))
      .toBe(original);
  });

  it("recovers v1 after replacement fails with the original moved aside", async () => {
    const filePath = await createFilePath();
    const original = JSON.stringify(v1File);
    await writeFile(filePath, original, "utf8");
    let replacementAttempts = 0;
    const fileOps: AtomicFileOperations = {
      mkdir: (path, options) => mkdir(path, options),
      writeFile: (path, content, encoding) => writeFile(path, content, encoding),
      rename: async (oldPath, newPath) => {
        if (oldPath.includes(".tmp") && newPath === filePath) {
          replacementAttempts += 1;
          throw fileSystemError(replacementAttempts === 1 ? "EPERM" : "EACCES");
        }
        if (oldPath === `${filePath}.bak` && newPath === filePath) {
          throw fileSystemError("EACCES");
        }
        await rename(oldPath, newPath);
      },
      rm: (path, options) => rm(path, options),
    };

    await expect(migrateMemoryFileOnDisk({
      filePath,
      now,
      idFactory,
      atomicWrite: (path, content) => writeFileAtomically(path, content, fileOps),
    })).rejects.toMatchObject({ code: "EACCES" });

    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(`${filePath}.bak`, "utf8")).toBe(original);

    await recoverInterruptedAtomicWrite(filePath);

    expect(await readFile(filePath, "utf8")).toBe(original);
    await expect(readFile(`${filePath}.bak`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("is idempotent across repeated disk migration", async () => {
    const filePath = await createFilePath();
    await writeFile(filePath, JSON.stringify(v1File), "utf8");

    const first = await migrateMemoryFileOnDisk({ filePath, now, idFactory });
    const second = await migrateMemoryFileOnDisk({ filePath, now, idFactory });

    expect(second).toEqual(first);
    expect(second.evidence).toHaveLength(1);
    expect((await readdir(join(filePath, ".."))).filter((name) => name.includes("pre-v2")))
      .toEqual([`memory.pre-v2-${NOW}.json`]);
  });
});
