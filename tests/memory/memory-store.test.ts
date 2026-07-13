import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFileAtomically } from "../../src/main/rag/atomic-file-write.js";
import {
  createMemoryStore,
  defaultMemoryPath,
} from "../../src/main/memory/memory-store.js";

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

    await expect(store.load()).resolves.toEqual({
      schemaVersion: 1,
      l0: { longTermInterests: [], permanentNotes: [] },
      l1: { recentGoals: [], recentPreferences: [] },
      l2: [],
    });
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
      schemaVersion: 1,
      l0: { longTermInterests: [], permanentNotes: [] },
      l1: {
        currentProject: "stale project",
        recentGoals: [],
        recentPreferences: [],
      },
      l2: [],
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

    await expect(store.load()).resolves.toEqual({
      schemaVersion: 1,
      l0: { longTermInterests: [], permanentNotes: [] },
      l1: { recentGoals: [], recentPreferences: [] },
      l2: [],
    });

    await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(dirname(filePath), "memory.corrupt-123.json"), "utf8")).toBe("{ invalid");
  });

  it("archives an invalid schema version without creating a replacement file", async () => {
    const filePath = await createFilePath();
    await writeFile(filePath, JSON.stringify({ schemaVersion: 2 }), "utf8");
    const store = createMemoryStore({ filePath, now: () => 456 });

    await expect(store.load()).resolves.toMatchObject({ schemaVersion: 1 });
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

describe("defaultMemoryPath", () => {
  it("uses the Cyrene application directory", () => {
    expect(defaultMemoryPath("C:\\Users\\test")).toBe(
      join("C:\\Users\\test", ".cyrene-agent-replica-lab", "memory.json"),
    );
  });
});
