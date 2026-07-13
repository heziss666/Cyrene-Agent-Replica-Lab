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
});
