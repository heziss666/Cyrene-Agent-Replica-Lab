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
} as const;
