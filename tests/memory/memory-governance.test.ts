import { describe, expect, it, vi } from "vitest";
import {
  createMemoryGovernanceService,
  type MemoryGovernanceService,
} from "../../src/main/memory/memory-governance.js";
import type { MemoryStore } from "../../src/main/memory/memory-store.js";
import {
  createEmptyMemoryFileV2,
  isRecallableL2,
  type ConflictLog,
  type L2MemoryV2,
  type MemoryFile,
} from "../../src/main/memory/memory-types.js";
import type { UpdateProfileFieldInput } from "../../src/shared/memory-api-types.js";

const INITIAL_TIME = "2026-07-13T00:00:00.000Z";
const MUTATION_TIME = "2026-07-14T01:02:03.004Z";

function createMemory(
  id: string,
  overrides: Partial<L2MemoryV2> = {},
): L2MemoryV2 {
  return {
    id,
    content: `Content for ${id}`,
    confidence: 0.8,
    importance: "medium",
    evidenceIds: [`evidence-${id}`],
    createdAt: INITIAL_TIME,
    updatedAt: INITIAL_TIME,
    lastAccessedAt: INITIAL_TIME,
    accessCount: 0,
    weight: 0.48,
    isPinned: false,
    isEnabled: true,
    status: "active",
    syncStatus: "synced",
    isSummary: false,
    sourceMemoryIds: [],
    sourceSnapshots: [],
    conflictWith: [],
    ...overrides,
  };
}

function createConflict(
  id: string,
  sourceMemoryId: string,
  targetMemoryId: string,
  status: ConflictLog["status"] = "queued",
): ConflictLog {
  return {
    id,
    sourceMemoryId,
    targetMemoryId,
    createdAt: INITIAL_TIME,
    status,
    score: 80,
    priority: "high",
    attempts: 0,
    signals: {},
  };
}

function createFile(memories: L2MemoryV2[] = []): MemoryFile {
  return {
    ...createEmptyMemoryFileV2(),
    l2: structuredClone(memories),
    evidence: memories.flatMap((memory) => memory.evidenceIds.map((id) => ({
      id,
      memoryId: memory.id,
      quote: memory.content,
      capturedAt: INITIAL_TIME,
      source: "conversation" as const,
      sourceMemoryIds: structuredClone(memory.sourceMemoryIds),
    }))),
  };
}

interface TestStore extends MemoryStore {
  updateCalls: number;
  read(): MemoryFile;
  mutateBeforeNextUpdate(mutator: (draft: MemoryFile) => void): void;
}

function createStore(initial: MemoryFile): TestStore {
  let file = structuredClone(initial);
  let beforeNextUpdate: ((draft: MemoryFile) => void) | undefined;
  const store: TestStore = {
    updateCalls: 0,
    load: vi.fn(async () => structuredClone(file)),
    async update(mutator) {
      store.updateCalls += 1;
      if (beforeNextUpdate) {
        const concurrentDraft = structuredClone(file);
        beforeNextUpdate(concurrentDraft);
        file = concurrentDraft;
        beforeNextUpdate = undefined;
      }
      const draft = structuredClone(file);
      mutator(draft);
      file = draft;
      return structuredClone(file);
    },
    read: () => structuredClone(file),
    mutateBeforeNextUpdate(mutator) {
      beforeNextUpdate = mutator;
    },
  };
  return store;
}

function createService(
  store: MemoryStore,
  ids: string[] = ["audit-1", "audit-2", "audit-3"],
): MemoryGovernanceService {
  return createMemoryGovernanceService({
    store,
    now: () => Date.parse(MUTATION_TIME),
    idFactory: () => ids.shift() ?? "generated-id",
  });
}

function expectSuccess(result: Awaited<ReturnType<MemoryGovernanceService["updateL2"]>>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.snapshot;
}

describe("MemoryGovernanceService profile governance", () => {
  it.each<[UpdateProfileFieldInput, string | string[]]>([
    [{ layer: "L0", field: "preferredName", value: "  Alex  " }, "Alex"],
    [{ layer: "L0", field: "longTermInterests", value: [" TypeScript ", "Databases"] }, ["TypeScript", "Databases"]],
    [{ layer: "L1", field: "currentProject", value: "  Cyrene  " }, "Cyrene"],
    [{ layer: "L1", field: "recentGoals", value: [" Ship phase 7B "] }, ["Ship phase 7B"]],
  ])("updates and normalizes $layer.$field in one transaction", async (input, expected) => {
    const store = createStore(createFile());
    const service = createService(store);

    const result = await service.updateProfileField(input);

    expect(result.ok).toBe(true);
    expect(store.updateCalls).toBe(1);
    const profile = input.layer === "L0" ? store.read().l0 : store.read().l1;
    expect(profile[input.field as keyof typeof profile]).toEqual(expected);
    expect((profile.fieldMetadata as Record<string, unknown> | undefined)?.[input.field]).toEqual({
      updatedAt: MUTATION_TIME,
      source: "user_edit",
    });
    expect(profile.updatedAt).toBe(MUTATION_TIME);
    expect(store.read().auditLogs).toHaveLength(1);
  });

  it("rejects forbidden array content before opening a transaction", async () => {
    const store = createStore(createFile());
    const service = createService(store);

    const result = await service.updateProfileField({
      layer: "L0",
      field: "permanentNotes",
      value: ["safe", "password: example-only"],
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid_content",
      message: "Memory content is not allowed: forbidden_sensitive_data",
    });
    expect(store.updateCalls).toBe(0);
    expect(store.read().auditLogs).toEqual([]);
  });

  it("returns invalid_state for no-op and stale profile writes without a success log", async () => {
    const file = createFile();
    file.l0.preferredName = "Alex";
    file.l0.fieldMetadata = {
      preferredName: { updatedAt: INITIAL_TIME, source: "user_edit" },
    };
    const store = createStore(file);
    const service = createService(store);

    await expect(service.updateProfileField({
      layer: "L0",
      field: "preferredName",
      value: "Alex",
    })).resolves.toMatchObject({ ok: false, code: "invalid_state" });
    expect(store.updateCalls).toBe(0);

    store.mutateBeforeNextUpdate((draft) => {
      draft.l0.preferredName = "Concurrent value";
      draft.l0.fieldMetadata!.preferredName = {
        updatedAt: "2026-07-14T00:59:00.000Z",
        source: "user_edit",
      };
    });
    await expect(service.updateProfileField({
      layer: "L0",
      field: "preferredName",
      value: "New value",
    })).resolves.toMatchObject({ ok: false, code: "invalid_state" });

    expect(store.updateCalls).toBe(1);
    expect(store.read().l0.preferredName).toBe("Concurrent value");
    expect(store.read().auditLogs).toEqual([]);
  });

  it("deletes a profile field and clears a populated profile layer", async () => {
    const file = createFile();
    file.l0.preferredName = "Alex";
    file.l0.longTermInterests = ["TypeScript"];
    file.l0.fieldMetadata = {
      preferredName: { updatedAt: INITIAL_TIME, source: "user_edit" },
      longTermInterests: { updatedAt: INITIAL_TIME, source: "user_edit" },
    };
    const store = createStore(file);
    const service = createService(store);

    expect((await service.deleteProfileField({
      layer: "L0",
      field: "preferredName",
    })).ok).toBe(true);
    expect(store.read().l0.preferredName).toBeUndefined();
    expect(store.read().l0.fieldMetadata?.preferredName).toBeUndefined();

    expect((await service.clearLayer("L0")).ok).toBe(true);
    expect(store.read().l0).toEqual({
      longTermInterests: [],
      permanentNotes: [],
      updatedAt: MUTATION_TIME,
      fieldMetadata: {},
    });
    expect(store.updateCalls).toBe(2);
    expect(store.read().auditLogs).toHaveLength(2);
  });
});

describe("MemoryGovernanceService L2 governance", () => {
  it("updates L2 content with fresh user-edit evidence and pending sync", async () => {
    const memory = createMemory("memory-1");
    const store = createStore(createFile([memory]));
    const service = createService(store, ["evidence-user-edit", "audit-update"]);

    const snapshot = expectSuccess(await service.updateL2({
      id: memory.id,
      content: "  I prefer TypeScript  ",
    }));

    expect(store.updateCalls).toBe(1);
    expect(store.read().l2[0]).toMatchObject({
      content: "I prefer TypeScript",
      updatedAt: MUTATION_TIME,
      syncStatus: "pending_sync",
      evidenceIds: ["evidence-user-edit"],
    });
    expect(store.read().evidence).toEqual([{
      id: "evidence-user-edit",
      memoryId: memory.id,
      quote: "I prefer TypeScript",
      capturedAt: MUTATION_TIME,
      source: "user_edit",
      sourceMemoryIds: [],
    }]);
    expect(snapshot.l2[0]).not.toHaveProperty("evidenceIds");
    expect(snapshot).not.toHaveProperty("evidence");
  });

  it("pins at weight 1, keeps explicit governance allowed, and disables without changing lifecycle", async () => {
    const memory = createMemory("memory-1", { status: "aging", weight: 0.2 });
    const store = createStore(createFile([memory]));
    const service = createService(store);

    expect((await service.setL2Pinned({ id: memory.id, pinned: true })).ok).toBe(true);
    expect(store.read().l2[0]).toMatchObject({ isPinned: true, weight: 1 });

    expect((await service.setL2Enabled({ id: memory.id, enabled: false })).ok).toBe(true);
    expect(store.read().l2[0]).toMatchObject({
      isPinned: true,
      isEnabled: false,
      status: "aging",
    });
    expect(isRecallableL2(store.read().l2[0])).toBe(false);

    expect((await service.updateL2({ id: memory.id, content: "Explicit pinned edit" })).ok)
      .toBe(true);
    expect(store.read().l2[0].content).toBe("Explicit pinned edit");
  });

  it("restores archived and resolved memories while clearing executable resolution state", async () => {
    const restored = createMemory("restored", {
      status: "superseded",
      supersededBy: "winner",
      conflictWith: ["winner"],
      isPinned: true,
    });
    const winner = createMemory("winner", { conflictWith: ["restored"] });
    const file = createFile([restored, winner]);
    file.conflictLogs = [createConflict("conflict-1", "restored", "winner", "uncertain")];
    const store = createStore(file);
    const service = createService(store);

    const result = await service.restoreL2("restored");

    expect(result.ok).toBe(true);
    expect(store.read().l2[0]).toMatchObject({
      status: "active",
      syncStatus: "pending_sync",
      isPinned: true,
      conflictWith: [],
    });
    expect(store.read().l2[0].supersededBy).toBeUndefined();
    expect(store.read().l2[1].conflictWith).toEqual([]);
    expect(store.read().conflictLogs[0]).toMatchObject({
      status: "failed",
      finishedAt: MUTATION_TIME,
    });
  });

  it("deletes L2 with evidence/link cascades and disables summaries whose source vanished", async () => {
    const source = createMemory("source", { conflictWith: ["peer"] });
    const peer = createMemory("peer", {
      conflictWith: ["source"],
      supersededBy: "source",
      status: "superseded",
    });
    const summary = createMemory("summary", {
      isSummary: true,
      sourceMemoryIds: ["source", "peer"],
      sourceSnapshots: [
        { memoryId: "source", updatedAt: INITIAL_TIME },
        { memoryId: "peer", updatedAt: INITIAL_TIME },
      ],
    });
    const file = createFile([source, peer, summary]);
    file.evidence.find((item) => item.memoryId === "summary")!.sourceMemoryIds = ["source", "peer"];
    file.conflictLogs = [createConflict("conflict-1", "source", "peer")];
    file.reflectionLogs = [{
      id: "reflection-1",
      createdAt: INITIAL_TIME,
      type: "compression",
      sourceMemoryIds: ["source", "peer"],
      acceptedCount: 1,
      skippedCount: 0,
    }];
    const store = createStore(file);
    const service = createService(store);

    const result = await service.deleteL2("source");

    expect(result.ok).toBe(true);
    expect(store.read().l2.map((item) => item.id)).toEqual(["peer", "summary"]);
    expect(store.read().evidence.some((item) => item.memoryId === "source")).toBe(false);
    expect(store.read().evidence.flatMap((item) => item.sourceMemoryIds)).not.toContain("source");
    expect(store.read().l2[0].conflictWith).toEqual([]);
    expect(store.read().l2[0].supersededBy).toBeUndefined();
    expect(store.read().l2[1]).toMatchObject({
      isEnabled: false,
      syncStatus: "sync_failed",
      sourceMemoryIds: ["peer"],
      sourceSnapshots: [{ memoryId: "peer", updatedAt: INITIAL_TIME }],
    });
    expect(store.read().conflictLogs[0]).toMatchObject({
      status: "failed",
      finishedAt: MUTATION_TIME,
    });
    expect(store.read().reflectionLogs[0].sourceMemoryIds).toEqual(["peer"]);
    expect(JSON.stringify(store.read().auditLogs)).not.toContain(source.content);
  });

  it("clears L2 while retaining only non-executable, content-free conflict history", async () => {
    const first = createMemory("first", { content: "private first", conflictWith: ["second"] });
    const second = createMemory("second", { content: "private second", conflictWith: ["first"] });
    const file = createFile([first, second]);
    file.conflictLogs = [createConflict("conflict-1", "first", "second", "processing")];
    const store = createStore(file);
    const service = createService(store);

    const result = await service.clearLayer("L2");

    expect(result.ok).toBe(true);
    expect(store.read().l2).toEqual([]);
    expect(store.read().evidence).toEqual([]);
    expect(store.read().conflictLogs).toEqual([expect.objectContaining({
      id: "conflict-1",
      status: "failed",
      finishedAt: MUTATION_TIME,
    })]);
    const serializedHistory = JSON.stringify(store.read().conflictLogs);
    expect(serializedHistory).not.toContain("private first");
    expect(serializedHistory).not.toContain("private second");
  });

  it("rejects invalid, missing, no-op, and stale L2 writes without success logs", async () => {
    const memory = createMemory("memory-1");
    const store = createStore(createFile([memory]));
    const service = createService(store);

    await expect(service.updateL2({ id: memory.id, content: "password: example-only" }))
      .resolves.toMatchObject({ ok: false, code: "invalid_content" });
    await expect(service.deleteL2("missing")).resolves.toMatchObject({
      ok: false,
      code: "not_found",
    });
    await expect(service.setL2Enabled({ id: memory.id, enabled: true })).resolves.toMatchObject({
      ok: false,
      code: "invalid_state",
    });
    expect(store.updateCalls).toBe(0);

    store.mutateBeforeNextUpdate((draft) => {
      draft.l2[0].content = "Concurrent edit";
      draft.l2[0].updatedAt = "2026-07-14T00:59:00.000Z";
    });
    await expect(service.updateL2({ id: memory.id, content: "Stale edit" }))
      .resolves.toMatchObject({ ok: false, code: "invalid_state" });

    expect(store.updateCalls).toBe(1);
    expect(store.read().l2[0].content).toBe("Concurrent edit");
    expect(store.read().auditLogs).toEqual([]);
  });
});

describe("MemoryGovernanceService audit metadata and snapshots", () => {
  it("appends exactly one safe audit entry per success with deterministic IDs and time", async () => {
    const memory = createMemory("memory-1", { content: "do not audit this content" });
    const store = createStore(createFile([memory]));
    const service = createService(store, ["audit-pin"]);

    const result = await service.setL2Pinned({ id: memory.id, pinned: true });

    expect(result.ok).toBe(true);
    expect(store.read().auditLogs).toEqual([{
      id: "audit-pin",
      createdAt: MUTATION_TIME,
      operation: "set_l2_pinned",
      targetType: "L2",
      targetId: "memory-1",
      source: "user",
      result: "success",
    }]);
    const serialized = JSON.stringify(store.read().auditLogs);
    expect(serialized).not.toContain(memory.content);
    expect(serialized).not.toContain("quote");
    expect(serialized).not.toContain("C:\\");
  });

  it("trims audit logs to the exact 500 newest entries", async () => {
    const memory = createMemory("memory-1");
    const file = createFile([memory]);
    file.auditLogs = Array.from({ length: 500 }, (_, index) => ({
      id: `old-${index}`,
      createdAt: INITIAL_TIME,
      operation: "old_operation",
      targetType: "L2",
      source: "system" as const,
      result: "success" as const,
    }));
    const store = createStore(file);
    const service = createService(store, ["new-audit"]);

    expect((await service.setL2Pinned({ id: memory.id, pinned: true })).ok).toBe(true);

    expect(store.read().auditLogs).toHaveLength(500);
    expect(store.read().auditLogs[0].id).toBe("old-1");
    expect(store.read().auditLogs.at(-1)?.id).toBe("new-audit");
  });

  it("returns renderer-safe snapshots without evidence, source snapshots, signals, or model reasons", async () => {
    const memory = createMemory("memory-1", {
      sourceSnapshots: [{ memoryId: "source", updatedAt: INITIAL_TIME }],
    });
    const file = createFile([memory]);
    file.conflictLogs = [{
      ...createConflict("conflict-1", "memory-1", "other", "resolved"),
      resolutionReason: "raw model output with private quote",
      resolutionType: "unrelated",
      resolutionConfidence: 0.9,
    }];
    const service = createService(createStore(file));

    const snapshot = await service.snapshot();

    expect(snapshot.l2[0]).not.toHaveProperty("evidenceIds");
    expect(snapshot.l2[0]).not.toHaveProperty("sourceSnapshots");
    expect(snapshot.conflicts[0]).not.toHaveProperty("signals");
    expect(snapshot.conflicts[0]).not.toHaveProperty("resolutionReason");
    expect(JSON.stringify(snapshot)).not.toContain("raw model output");
  });
});
