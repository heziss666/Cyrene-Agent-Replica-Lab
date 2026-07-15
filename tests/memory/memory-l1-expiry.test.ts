import { describe, expect, it, vi } from "vitest";
import { MemoryL1Expiry } from "../../src/main/memory/memory-l1-expiry.js";
import type { MemoryStore } from "../../src/main/memory/memory-store.js";
import {
  createEmptyMemoryFileV2,
  type L1Field,
  type MemoryFile,
} from "../../src/main/memory/memory-types.js";

const NOW = new Date("2026-07-15T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;

function createStore(initial: MemoryFile) {
  let file = structuredClone(initial);
  const store: MemoryStore & { updateCalls: number; read(): MemoryFile } = {
    updateCalls: 0,
    load: vi.fn(async () => structuredClone(file)),
    async update(mutator) {
      store.updateCalls += 1;
      const draft = structuredClone(file);
      mutator(draft);
      file = draft;
      return structuredClone(file);
    },
    read: () => structuredClone(file),
  };
  return store;
}

function timestampBefore(days: number, extraMs = 0): string {
  return new Date(NOW.getTime() - days * DAY_MS + extraMs).toISOString();
}

describe("MemoryL1Expiry", () => {
  it.each([
    ["currentProject", 90],
    ["recentGoals", 45],
    ["recentPreferences", 30],
  ] as const)("retains %s one millisecond before its threshold", async (field, days) => {
    const initial = fileWithL1Field(field, timestampBefore(days, 1));
    const store = createStore(initial);
    const service = new MemoryL1Expiry({ store, idFactory: () => "audit-expiry" });

    await expect(service.expireL1(NOW)).resolves.toEqual({ expiredFields: [] });
    expect(store.read().l1).toEqual(initial.l1);
  });

  it("expires every field exactly at its threshold in one transaction", async () => {
    const initial = createEmptyMemoryFileV2();
    initial.l1 = {
      currentProject: "Private project",
      recentGoals: ["Private goal"],
      recentPreferences: ["Private preference"],
      fieldMetadata: {
        currentProject: { updatedAt: timestampBefore(90), source: "judge" },
        recentGoals: { updatedAt: timestampBefore(45), source: "reflection" },
        recentPreferences: { updatedAt: timestampBefore(30), source: "user_edit" },
      },
    };
    const store = createStore(initial);
    const service = new MemoryL1Expiry({
      store,
      idFactory: () => "audit-expiry-1",
    });

    const result = await service.expireL1(NOW);

    expect(result).toEqual({
      expiredFields: ["currentProject", "recentGoals", "recentPreferences"],
    });
    expect(store.updateCalls).toBe(1);
    expect(store.read().l1).toEqual({
      recentGoals: [],
      recentPreferences: [],
      fieldMetadata: {},
    });
    expect(store.read().auditLogs).toEqual([{
      id: "audit-expiry-1",
      createdAt: NOW.toISOString(),
      operation: "expire_l1",
      targetType: "L1",
      field: "currentProject,recentGoals,recentPreferences",
      source: "automatic",
      result: "success",
      code: "expired=3",
    }]);
    expect(JSON.stringify(store.read().auditLogs)).not.toContain("Private");
  });

  it("retains migrated content without field metadata", async () => {
    const initial = createEmptyMemoryFileV2();
    initial.l1.currentProject = "Migrated project";
    initial.l1.recentGoals = ["Migrated goal"];
    initial.l1.recentPreferences = ["Migrated preference"];
    initial.l1.fieldMetadata = undefined;
    const store = createStore(initial);
    const service = new MemoryL1Expiry({ store });

    await expect(service.expireL1(NOW)).resolves.toEqual({ expiredFields: [] });
    expect(store.read().l1).toEqual(initial.l1);
  });

  it.each([
    ["invalid now", () => new Date(Number.NaN), timestampBefore(90)],
    ["invalid field metadata", () => NOW, "not-a-timestamp"],
  ])("rejects %s without modifying the store", async (_label, createNow, updatedAt) => {
    const initial = fileWithL1Field("currentProject", updatedAt);
    const store = createStore(initial);
    const service = new MemoryL1Expiry({ store });

    await expect(service.expireL1(createNow())).rejects.toThrow("Invalid timestamp");
    expect(store.read()).toEqual(initial);
  });
});

function fileWithL1Field(field: L1Field, updatedAt: string): MemoryFile {
  const file = createEmptyMemoryFileV2();
  if (field === "currentProject") file.l1.currentProject = "Private project";
  if (field === "recentGoals") file.l1.recentGoals = ["Private goal"];
  if (field === "recentPreferences") file.l1.recentPreferences = ["Private preference"];
  file.l1.fieldMetadata = { [field]: { updatedAt, source: "judge" } };
  return file;
}
