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

describe("CyreneApi conversations contract", () => {
  it("exposes managed operations without filesystem access", async () => {
    const conversations: CyreneApi["conversations"] = {
      list: async () => ({ activeConversationId: "conv_1", conversations: [] }),
      create: async () => ({ conversation: {} as never }),
      get: async () => ({} as never),
      setActive: async () => ({} as never),
      rename: async () => ({} as never),
      remove: async () => ({ activeConversationId: "conv_1" }),
      setMessagePinned: async () => ({} as never),
      onChanged: () => () => undefined,
    };

    await expect(conversations.list()).resolves.toMatchObject({ activeConversationId: "conv_1" });
    expect(Object.keys(conversations)).not.toContain("readFile");
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

describe("CyreneApi skills contract", () => {
  it("exposes list, setEnabled, and reload without paths", async () => {
    const snapshot = { skills: [], diagnostics: [] };
    const skills = {
      list: async () => snapshot,
      setEnabled: async (_id: string, _enabled: boolean) => snapshot,
      reload: async () => snapshot,
    } satisfies CyreneApi["skills"];

    await expect(skills.list()).resolves.toBe(snapshot);
    await expect(skills.setEnabled("tutor", false)).resolves.toBe(snapshot);
    await expect(skills.reload()).resolves.toBe(snapshot);
  });
});

describe("CyreneApi MCP contract", () => {
  it("exposes management and single-use approval methods", async () => {
    const snapshot = { servers: [] };
    const mcp = {
      list: async () => snapshot,
      add: async (_config) => snapshot,
      update: async (_id, _patch) => snapshot,
      remove: async (_id) => snapshot,
      reconnect: async (_id) => snapshot,
      setEnabled: async (_id, _enabled) => snapshot,
      setToolOptions: async (_serverId, _toolName, _options) => snapshot,
      onApprovalRequested: (_listener) => () => undefined,
      resolveApproval: async (_id, _allowed) => ({ resolved: true }),
    } satisfies CyreneApi["mcp"];

    await expect(mcp.list()).resolves.toBe(snapshot);
    await expect(mcp.resolveApproval("approval-1", false)).resolves.toEqual({ resolved: true });
  });
});
