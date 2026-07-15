import { describe, expect, it } from "vitest";
import type {
  CyreneApi,
  PersonaStyleResult,
} from "../../src/shared/electron-api.js";
import type {
  MemoryAuditReport,
  MemoryMutationResult,
  MemorySnapshot,
} from "../../src/shared/memory-api-types.js";

describe("CyreneApi persona contract", () => {
  it("uses a validated style id for get and set results", async () => {
    const result: PersonaStyleResult = { styleId: "healing" };
    const persona: CyreneApi["persona"] = {
      getStyle: async () => result,
      setStyle: async (styleId) => ({ styleId }),
    };

    await expect(persona.getStyle()).resolves.toEqual({ styleId: "healing" });
    await expect(persona.setStyle("sweet")).resolves.toEqual({ styleId: "sweet" });
  });
});

describe("CyreneApi memory contract", () => {
  it("requires the Phase 7C maintenance method with the governance methods", async () => {
    const snapshot = { l2: [] } as unknown as MemorySnapshot;
    const mutation = { ok: true, snapshot } satisfies MemoryMutationResult;
    const audit = { ok: true, findings: [] } satisfies MemoryAuditReport;
    const memory = {
      getSnapshot: async () => snapshot,
      updateProfileField: async () => mutation,
      updateL2: async () => mutation,
      deleteProfileField: async () => mutation,
      deleteL2: async () => mutation,
      setL2Pinned: async () => mutation,
      setL2Enabled: async () => mutation,
      restoreL2: async () => mutation,
      clearLayer: async () => mutation,
      getAuditReport: async () => audit,
      runMaintenance: async () => ({ runId: "maintenance-run-1" }),
    } satisfies CyreneApi["memory"];
    const apiMemory: CyreneApi["memory"] = memory;

    expect(Object.keys(apiMemory)).toEqual([
      "getSnapshot",
      "updateProfileField",
      "updateL2",
      "deleteProfileField",
      "deleteL2",
      "setL2Pinned",
      "setL2Enabled",
      "restoreL2",
      "clearLayer",
      "getAuditReport",
      "runMaintenance",
    ]);
    await expect(apiMemory.getSnapshot()).resolves.toBe(snapshot);
    await expect(apiMemory.getAuditReport()).resolves.toBe(audit);
    await expect(apiMemory.runMaintenance()).resolves.toEqual({ runId: "maintenance-run-1" });
  });
});
