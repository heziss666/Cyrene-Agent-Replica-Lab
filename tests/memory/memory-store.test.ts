import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFileAtomically } from "../../src/main/rag/atomic-file-write.js";
import {
  createMemoryStore,
  defaultMemoryPath,
  validateMemoryFile,
} from "../../src/main/memory/memory-store.js";
import { createEmptyMemoryFileV2 } from "../../src/main/memory/memory-types.js";

const fileSystem = vi.hoisted(() => ({
  controlledRead: undefined as undefined | ((...args: any[]) => Promise<any>),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  const originalReadFile = original.readFile as (...args: any[]) => Promise<any>;
  return {
    ...original,
    readFile: (...args: any[]) => fileSystem.controlledRead
      ? fileSystem.controlledRead(...args)
      : originalReadFile(...args),
  };
});

const directories: string[] = [];

async function createFilePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cyrene-memory-store-"));
  directories.push(directory);
  return join(directory, "memory.json");
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function populatedMemoryFileV2() {
  const timestamp = "2026-07-14T08:00:00.000Z";
  return {
    ...createEmptyMemoryFileV2(),
    l0: {
      preferredName: "Alex",
      longTermInterests: [],
      permanentNotes: [],
      fieldMetadata: {
        preferredName: { updatedAt: timestamp, source: "judge" as const },
      },
    },
    l2: [{
      id: "memory-1",
      content: "Completed Phase 7A",
      confidence: 0.9,
      importance: "high" as const,
      evidenceIds: ["evidence-1"],
      createdAt: timestamp,
      updatedAt: timestamp,
      lastAccessedAt: timestamp,
      accessCount: 0,
      weight: 0.765,
      isPinned: false,
      isEnabled: true,
      status: "active" as const,
      syncStatus: "pending_sync" as const,
      isSummary: false,
      sourceMemoryIds: [],
      sourceSnapshots: [{ memoryId: "source-1", updatedAt: timestamp }],
      conflictWith: [],
    }],
    evidence: [{
      id: "evidence-1",
      memoryId: "memory-1",
      quote: "I completed Phase 7A",
      capturedAt: timestamp,
      source: "conversation" as const,
      sourceMemoryIds: [],
    }],
    conflictLogs: [{
      id: "conflict-1",
      sourceMemoryId: "memory-1",
      targetMemoryId: "memory-2",
      createdAt: timestamp,
      status: "queued" as const,
      score: 0.8,
      priority: "normal" as const,
      attempts: 0,
      signals: { semanticSimilarity: 0.9 },
    }],
    reflectionLogs: [{
      id: "reflection-1",
      createdAt: timestamp,
      type: "lifecycle" as const,
      sourceMemoryIds: ["memory-1"],
      acceptedCount: 1,
      skippedCount: 0,
    }],
    auditLogs: [{
      id: "audit-1",
      createdAt: timestamp,
      operation: "create",
      targetType: "memory",
      source: "system" as const,
      result: "success" as const,
    }],
    maintenance: {
      successfulWritesSinceMaintenance: 1,
      running: false,
      lastMaintenanceAt: timestamp,
    },
  };
}

afterEach(async () => {
  fileSystem.controlledRead = undefined;
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("createMemoryStore", () => {
  it("returns an empty schema without creating a file", async () => {
    const filePath = await createFilePath();
    const store = createMemoryStore({ filePath });

    await expect(store.load()).resolves.toEqual(createEmptyMemoryFileV2());
    await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("commits an update atomically and reloads it", async () => {
    const filePath = await createFilePath();
    const store = createMemoryStore({ filePath });

    await store.update((draft) => {
      draft.l0.preferredName = "小明";
    });

    const reloaded = createMemoryStore({ filePath });
    expect((await reloaded.load()).l0.preferredName).toBe("小明");
  });

  it("preserves accepted v2 extension fields through load, cache, and update", async () => {
    const filePath = await createFilePath();
    const original = {
      ...createEmptyMemoryFileV2(),
      extension: { provider: "future-runtime", revision: 3 },
    };
    await writeFile(filePath, JSON.stringify(original), "utf8");
    const store = createMemoryStore({ filePath });

    await expect(store.load()).resolves.toEqual(original);
    const updated = await store.update((draft) => {
      draft.l1.currentProject = "Cyrene";
    });
    const expected = {
      ...original,
      l1: { ...original.l1, currentProject: "Cyrene" },
    };

    expect(updated).toEqual(expected);
    await expect(store.load()).resolves.toEqual(expected);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(expected);
  });

  it("migrates each cold-load L2 exactly once", async () => {
    const filePath = await createFilePath();
    await writeFile(filePath, JSON.stringify({
      schemaVersion: 1,
      l0: { longTermInterests: [], permanentNotes: [] },
      l1: { recentGoals: [], recentPreferences: [] },
      l2: [{
        id: "memory-1",
        content: "Completed Phase 7A",
        confidence: 0.9,
        importance: "high",
        evidence: {
          userQuote: "I completed Phase 7A",
          capturedAt: "2026-07-14T08:00:00.000Z",
        },
        createdAt: "2026-07-14T08:00:00.000Z",
        status: "active",
      }],
    }), "utf8");
    const idFactory = vi.fn(() => "evidence-1");
    const store = createMemoryStore({
      filePath,
      now: () => 1_720_944_000_000,
      idFactory,
    });

    const loaded = await store.load();

    expect(idFactory).toHaveBeenCalledOnce();
    expect(loaded.l2[0]?.evidenceIds).toEqual(["evidence-1"]);
    expect(loaded.evidence).toHaveLength(1);
  });

  it("retries cold migration after failure without caching or duplicating backup evidence", async () => {
    const filePath = await createFilePath();
    const original = JSON.stringify({
      schemaVersion: 1,
      l0: { longTermInterests: [], permanentNotes: [] },
      l1: { recentGoals: [], recentPreferences: [] },
      l2: [{
        id: "memory-1",
        content: "Completed Phase 7A",
        confidence: 0.9,
        importance: "high",
        evidence: {
          userQuote: "I completed Phase 7A",
          capturedAt: "2026-07-14T08:00:00.000Z",
        },
        createdAt: "2026-07-14T08:00:00.000Z",
        status: "active",
      }],
    });
    await writeFile(filePath, original, "utf8");
    const atomicWrite = vi.fn()
      .mockRejectedValueOnce(new Error("replacement failed"))
      .mockImplementationOnce(writeFileAtomically);
    const store = createMemoryStore({
      filePath,
      now: () => 1_720_944_000_000,
      idFactory: () => "evidence-1",
      atomicWrite,
    });

    await expect(store.load()).rejects.toThrow("replacement failed");
    expect(await readFile(filePath, "utf8")).toBe(original);

    const migrated = await store.load();
    const cached = await store.load();

    expect(atomicWrite).toHaveBeenCalledTimes(2);
    expect(migrated.evidence).toHaveLength(1);
    expect(cached).toEqual(migrated);
    expect(cached.evidence).toHaveLength(1);
    expect((await readdir(dirname(filePath))).filter((name) => name.includes("pre-v2")))
      .toEqual(["memory.pre-v2-1720944000000.json"]);
  });

  it("recovers an interrupted atomic replacement and removes stale temporary files", async () => {
    const filePath = await createFilePath();
    const backupPath = `${filePath}.bak`;
    const temporaryPath = `${filePath}.123-stale.tmp`;
    await writeFile(backupPath, JSON.stringify({
      schemaVersion: 1,
      l0: {
        preferredName: "Alex",
        longTermInterests: [],
        permanentNotes: [],
      },
      l1: { recentGoals: [], recentPreferences: [] },
      l2: [],
    }), "utf8");
    await writeFile(temporaryPath, "incomplete replacement", "utf8");

    const store = createMemoryStore({ filePath });

    expect((await store.load()).l0.preferredName).toBe("Alex");
    await expect(stat(filePath)).resolves.toBeDefined();
    await expect(stat(backupPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(temporaryPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("quarantines a corrupt primary instead of replacing it from a stale backup", async () => {
    const filePath = await createFilePath();
    const backupPath = `${filePath}.bak`;
    await writeFile(filePath, "{ invalid", "utf8");
    await writeFile(backupPath, JSON.stringify({
      schemaVersion: 1,
      l0: {
        preferredName: "stale backup",
        longTermInterests: [],
        permanentNotes: [],
      },
      l1: { recentGoals: [], recentPreferences: [] },
      l2: [],
    }), "utf8");
    const store = createMemoryStore({ filePath, now: () => 789 });

    await expect(store.load()).resolves.toEqual(createEmptyMemoryFileV2());

    expect(await readFile(join(dirname(filePath), "memory.corrupt-789.json"), "utf8"))
      .toBe("{ invalid");
    await expect(readFile(backupPath, "utf8")).resolves.toContain("stale backup");
  });

  it("does not publish failed writes to its cache", async () => {
    const filePath = await createFilePath();
    const atomicWrite = vi.fn(async () => {
      throw new Error("disk full");
    });
    const store = createMemoryStore({ filePath, atomicWrite });

    await expect(store.update((draft) => {
      draft.l1.currentProject = "Cyrene";
    })).rejects.toThrow("disk full");
    expect((await store.load()).l1.currentProject).toBeUndefined();
  });

  it("returns defensive copies from loads and updates", async () => {
    const filePath = await createFilePath();
    const store = createMemoryStore({ filePath });

    const updated = await store.update((draft) => {
      draft.l0.longTermInterests.push("TypeScript");
    });
    updated.l0.longTermInterests.push("mutated result");

    const loaded = await store.load();
    loaded.l0.longTermInterests.push("mutated load");

    expect((await store.load()).l0.longTermInterests).toEqual(["TypeScript"]);
  });

  it("serializes concurrent updates", async () => {
    const filePath = await createFilePath();
    const firstWriteStarted = deferred();
    const releaseFirstWrite = deferred();
    let writes = 0;
    const atomicWrite = vi.fn(async (path: string, content: string) => {
      writes += 1;
      if (writes === 1) {
        firstWriteStarted.resolve();
        await releaseFirstWrite.promise;
      }
      await writeFileAtomically(path, content);
    });
    const store = createMemoryStore({ filePath, atomicWrite });

    const first = store.update((draft) => {
      draft.l1.recentGoals.push("first");
    });
    await firstWriteStarted.promise;

    let secondFinished = false;
    const second = store.update((draft) => {
      draft.l1.recentGoals.push("second");
    }).then(() => {
      secondFinished = true;
    });
    await Promise.resolve();
    expect(secondFinished).toBe(false);

    releaseFirstWrite.resolve();
    await Promise.all([first, second]);

    expect((await store.load()).l1.recentGoals).toEqual(["first", "second"]);
  });

  it("does not let a cold load overwrite a committed update", async () => {
    const filePath = await createFilePath();
    const staleFile = JSON.stringify({
      ...createEmptyMemoryFileV2(),
      l0: createEmptyMemoryFileV2().l0,
      l1: {
        ...createEmptyMemoryFileV2().l1,
        currentProject: "stale project",
      },
    });
    const firstReadStarted = deferred();
    const releaseFirstRead = deferred();
    let reads = 0;
    fileSystem.controlledRead = async () => {
      reads += 1;
      if (reads === 1) {
        firstReadStarted.resolve();
        await releaseFirstRead.promise;
      }
      return staleFile;
    };
    const store = createMemoryStore({
      filePath,
      atomicWrite: vi.fn(async () => undefined),
    });

    const load = store.load();
    await firstReadStarted.promise;

    const update = store.update((draft) => {
      draft.l1.currentProject = "committed project";
    });
    for (let turn = 0; turn < 10; turn += 1) {
      await Promise.resolve();
    }
    releaseFirstRead.resolve();
    await Promise.all([load, update]);

    expect((await store.load()).l1.currentProject).toBe("committed project");
  });

  it("archives corrupt JSON without creating a replacement file", async () => {
    const filePath = await createFilePath();
    await writeFile(filePath, "{ invalid", "utf8");
    const store = createMemoryStore({ filePath, now: () => 123 });

    await expect(store.load()).resolves.toEqual(createEmptyMemoryFileV2());

    await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(dirname(filePath), "memory.corrupt-123.json"), "utf8")).toBe("{ invalid");
  });

  it("archives an invalid schema version without creating a replacement file", async () => {
    const filePath = await createFilePath();
    await writeFile(filePath, JSON.stringify({ schemaVersion: 2 }), "utf8");
    const store = createMemoryStore({ filePath, now: () => 456 });

    await expect(store.load()).resolves.toMatchObject({ schemaVersion: 2 });
    await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(dirname(filePath), "memory.corrupt-456.json"), "utf8")).toBe(
      JSON.stringify({ schemaVersion: 2 }),
    );
  });

  it("rejects invalid mutations without writing them", async () => {
    const filePath = await createFilePath();
    const store = createMemoryStore({ filePath });

    await expect(store.update((draft) => {
      draft.l0.longTermInterests = ["valid", 42] as unknown as string[];
    })).rejects.toThrow("Invalid memory file");
    await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("validateMemoryFile", () => {
  it("validates and clones accepted v2 extension fields without dropping them", () => {
    const value = {
      ...createEmptyMemoryFileV2(),
      extension: { provider: "future-runtime", revision: 3 },
    };

    const validated = validateMemoryFile(value);

    expect(validated).toEqual(value);
    expect(validated).not.toBe(value);
    expect(validated.l0).not.toBe(value.l0);
  });

  it.each([
    ["nested L2", () => {
      const value = populatedMemoryFileV2();
      return {
        ...value,
        l2: [{
          ...value.l2[0],
          sourceSnapshots: [{ memoryId: "source-1", updatedAt: 42 }],
        }],
      };
    }, "l2[0].sourceSnapshots[0].updatedAt must be a string"],
    ["Evidence", () => {
      const value = populatedMemoryFileV2();
      return {
        ...value,
        evidence: [{ ...value.evidence[0], sourceMemoryIds: ["memory-1", 42] }],
      };
    }, "evidence[0].sourceMemoryIds must be an array of strings"],
    ["ConflictLog", () => {
      const value = populatedMemoryFileV2();
      return {
        ...value,
        conflictLogs: [{ ...value.conflictLogs[0], signals: { score: "high" } }],
      };
    }, "conflictLogs[0].signals.score must be a finite number"],
    ["ReflectionLog", () => {
      const value = populatedMemoryFileV2();
      return {
        ...value,
        reflectionLogs: [{ ...value.reflectionLogs[0], acceptedCount: "one" }],
      };
    }, "reflectionLogs[0].acceptedCount must be a finite number"],
    ["AuditLog", () => {
      const value = populatedMemoryFileV2();
      return {
        ...value,
        auditLogs: [{ ...value.auditLogs[0], source: "operator" }],
      };
    }, "auditLogs[0].source must be one of automatic, user, system"],
    ["profile metadata", () => {
      const value = populatedMemoryFileV2();
      return {
        ...value,
        l0: {
          ...value.l0,
          fieldMetadata: {
            preferredName: {
              ...value.l0.fieldMetadata.preferredName,
              confidence: "high",
            },
          },
        },
      };
    }, "l0.fieldMetadata.preferredName.confidence must be a finite number"],
    ["maintenance", () => {
      const value = populatedMemoryFileV2();
      return { ...value, maintenance: { ...value.maintenance, running: "no" } };
    }, "maintenance.running must be a boolean"],
  ] as const)("fails closed for malformed %s structures", (_label, createValue, message) => {
    expect(() => validateMemoryFile(createValue())).toThrow(message);
  });
});

describe("defaultMemoryPath", () => {
  it("uses the Cyrene application directory", () => {
    expect(defaultMemoryPath("C:\\Users\\test")).toBe(
      join("C:\\Users\\test", ".cyrene-agent-replica-lab", "memory.json"),
    );
  });
});
