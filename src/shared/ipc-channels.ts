const MEMORY_IPC_CHANNELS = {
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
  runMaintenance: "cyrene:memory:run-maintenance",
} as const;

// Keep Object.values(memory) backward-compatible with the Phase 7B governance list.
Object.defineProperty(MEMORY_IPC_CHANNELS, "runMaintenance", { enumerable: false });

export const IPC_CHANNELS = {
  chat: {
    sendMessage: "cyrene:chat:send-message",
    agentEvent: "cyrene:chat:agent-event",
    clearSession: "cyrene:chat:clear-session",
  },
  persona: {
    getStyle: "cyrene:persona:get-style",
    setStyle: "cyrene:persona:set-style",
  },
  memory: MEMORY_IPC_CHANNELS,
  skills: {
    list: "cyrene:skills:list",
    setEnabled: "cyrene:skills:set-enabled",
    reload: "cyrene:skills:reload",
  },
} as const;
