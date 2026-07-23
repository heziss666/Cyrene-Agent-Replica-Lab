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

  it("defines stable conversation management channels", () => {
    expect(IPC_CHANNELS.conversations).toEqual({
      list: "cyrene:conversations:list",
      create: "cyrene:conversations:create",
      get: "cyrene:conversations:get",
      setActive: "cyrene:conversations:set-active",
      rename: "cyrene:conversations:rename",
      remove: "cyrene:conversations:delete",
      setMessagePinned: "cyrene:conversations:set-message-pinned",
      changed: "cyrene:conversations:changed",
    });
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

  it("defines stable MCP management and approval channels", () => {
    expect(IPC_CHANNELS.mcp).toEqual({
      list: "cyrene:mcp:list",
      add: "cyrene:mcp:add",
      update: "cyrene:mcp:update",
      remove: "cyrene:mcp:remove",
      reconnect: "cyrene:mcp:reconnect",
      setEnabled: "cyrene:mcp:set-enabled",
      setToolOptions: "cyrene:mcp:set-tool-options",
      approvalRequest: "cyrene:mcp:approval-request",
      resolveApproval: "cyrene:mcp:resolve-approval",
    });
  });

  it("defines stable scheduler management channels", () => {
    expect(IPC_CHANNELS.scheduler).toEqual({
      listTasks: "cyrene:scheduler:list-tasks",
      createTask: "cyrene:scheduler:create-task",
      updateTask: "cyrene:scheduler:update-task",
      removeTask: "cyrene:scheduler:remove-task",
      setEnabled: "cyrene:scheduler:set-enabled",
      runNow: "cyrene:scheduler:run-now",
      listRuns: "cyrene:scheduler:list-runs",
      getRun: "cyrene:scheduler:get-run",
      clearHistory: "cyrene:scheduler:clear-history",
      changed: "cyrene:scheduler:changed",
    });
  });

  it("defines stable currency war state channels", () => {
    expect(IPC_CHANNELS.currencyWarState).toEqual({
      get: "currency-war:state:get",
      create: "currency-war:state:create",
      update: "currency-war:state:update",
      reset: "currency-war:state:reset",
      validate: "currency-war:state:validate",
    });
  });
});
