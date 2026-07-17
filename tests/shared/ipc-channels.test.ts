import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "../../src/shared/ipc-channels.js";

describe("IPC_CHANNELS", () => {
  it("defines stable chat IPC channel names", () => {
    expect(IPC_CHANNELS.chat.sendMessage).toBe("cyrene:chat:send-message");
    expect(IPC_CHANNELS.chat.agentEvent).toBe("cyrene:chat:agent-event");
    expect(IPC_CHANNELS.chat.clearSession).toBe("cyrene:chat:clear-session");
  });

  it("defines stable persona IPC channel names", () => {
    expect(IPC_CHANNELS.persona.getStyle).toBe("cyrene:persona:get-style");
    expect(IPC_CHANNELS.persona.setStyle).toBe("cyrene:persona:set-style");
  });

  it("defines exactly the Phase 7B memory governance channels", () => {
    expect(IPC_CHANNELS.memory).toEqual({
      getSnapshot: "cyrene:memory:get-snapshot",
      updateProfileField: "cyrene:memory:update-profile-field",
      updateL2: "cyrene:memory:update-l2",
      deleteProfileField: "cyrene:memory:delete-profile-field",
      deleteL2: "cyrene:memory:delete-l2",
      setPinned: "cyrene:memory:set-pinned",
      setEnabled: "cyrene:memory:set-enabled",
      restoreL2: "cyrene:memory:restore-l2",
      clearLayer: "cyrene:memory:clear-layer",
      getAuditReport: "cyrene:memory:get-audit-report",
    });
    expect(Object.keys(IPC_CHANNELS.memory)).not.toContain("runMaintenance");
  });

  it("defines stable skills management channels", () => {
    expect(IPC_CHANNELS.skills).toEqual({
      list: "cyrene:skills:list",
      setEnabled: "cyrene:skills:set-enabled",
      reload: "cyrene:skills:reload",
    });
  });
});
