import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../src/main/agent/agent-events.js";
import { registerChatIpc } from "../../src/main/app/register-chat-ipc.js";
import type { ChatMessage } from "../../src/shared/chat-types.js";
import type { ChatAgentEventPayload } from "../../src/shared/electron-api.js";
import { IPC_CHANNELS } from "../../src/shared/ipc-channels.js";

type IpcEvent = {
  sender: {
    send: (channel: string, payload: ChatAgentEventPayload) => void;
  };
};

type IpcHandler = (event: IpcEvent, payload?: unknown) => Promise<unknown>;

interface FakeIpcMain {
  handlers: Map<string, IpcHandler>;
  handle: (channel: string, handler: IpcHandler) => void;
}

const config = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  apiKey: "sk-test",
};

function createFakeIpcMain(): FakeIpcMain {
  const handlers = new Map<string, IpcHandler>();
  return {
    handlers,
    handle: (channel, handler) => handlers.set(channel, handler),
  };
}

function createSender() {
  return {
    sender: {
      send: vi.fn<(channel: string, payload: ChatAgentEventPayload) => void>(),
    },
  };
}

type RegisterDeps = Parameters<typeof registerChatIpc>[0];

function createFakeDeps(
  runAgent: ReturnType<typeof vi.fn>,
  overrides: Partial<RegisterDeps> = {},
): RegisterDeps & { ipcMain: FakeIpcMain } {
  const ipcMain = createFakeIpcMain();
  return {
    ipcMain,
    runAgent,
    createConfig: () => config,
    createToolRegistry: () => ({ getEnabledToolSpecs: () => [] }),
    createPromptComposer: () => ({
      composeSystemPrompt: ({
        styleId,
        transition,
      }: {
        styleId: string;
        transition?: { from: string; to: string };
      }) => `system:${styleId}:${transition ? `${transition.from}->${transition.to}` : "steady"}`,
    }),
    loadPersonaConfig: async () => ({ styleId: "default" }),
    savePersonaConfig: vi.fn(async () => undefined),
    adapter: {
      id: "fake",
      buildRequest: vi.fn(),
      parseResponse: vi.fn(),
      appendToolResults: vi.fn(),
    },
    ...overrides,
  } as RegisterDeps & { ipcMain: FakeIpcMain };
}

function successfulAgent() {
  return vi.fn(async ({
    messages,
    onEvent,
  }: {
    messages: ChatMessage[];
    onEvent?: (event: AgentEvent) => void;
    toolRegistry: unknown;
  }) => {
    onEvent?.({ type: "final_reply", round: 1, text: "reply" });
    return {
      reply: "reply",
      messages: [...messages, { role: "assistant" as const, content: "reply" }],
      toolResults: [],
    };
  });
}

describe("registerChatIpc", () => {
  it("uses one fresh dynamic system message while preserving non-system history", async () => {
    const runAgent = successfulAgent();
    const deps = createFakeDeps(runAgent);
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;

    const first = await send({ sender }, "first");
    const second = await send({ sender }, "second");

    expect(runAgent.mock.calls[0]?.[0].messages).toEqual([
      { role: "system", content: "system:default:steady" },
      { role: "user", content: "first" },
    ]);
    expect(runAgent.mock.calls[1]?.[0].messages).toEqual([
      { role: "system", content: "system:default:steady" },
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "second" },
    ]);
    expect(first).toEqual({
      reply: "reply",
      runId: "run_1",
      messageCount: 2,
      toolResultCount: 0,
    });
    expect(second).toMatchObject({ runId: "run_2", messageCount: 4 });
    expect(sender.send).toHaveBeenCalledWith(
      IPC_CHANNELS.chat.agentEvent,
      expect.objectContaining({ runId: "run_1" }),
    );
  });

  it("switches style without clearing history and uses the transition once", async () => {
    const runAgent = successfulAgent();
    const savePersonaConfig = vi.fn(async () => undefined);
    const deps = createFakeDeps(runAgent, { savePersonaConfig });
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;
    const setStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.setStyle)!;

    await send({ sender }, "remember this");
    await expect(setStyle({ sender }, "healing")).resolves.toEqual({ styleId: "healing" });
    await send({ sender }, "continue");
    await send({ sender }, "again");

    expect(savePersonaConfig).toHaveBeenCalledWith({ styleId: "healing" });
    expect(runAgent.mock.calls[1]?.[0].messages[0]).toEqual({
      role: "system",
      content: "system:healing:default->healing",
    });
    expect(runAgent.mock.calls[1]?.[0].messages).toContainEqual({
      role: "user",
      content: "remember this",
    });
    expect(runAgent.mock.calls[2]?.[0].messages[0]).toEqual({
      role: "system",
      content: "system:healing:steady",
    });
  });

  it("retains a pending transition when the model request fails", async () => {
    const runAgent = successfulAgent()
      .mockRejectedValueOnce(new Error("model unavailable"));
    const deps = createFakeDeps(runAgent);
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;
    const setStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.setStyle)!;
    await setStyle({ sender }, "sweet");

    await expect(send({ sender }, "failed turn")).rejects.toThrow("model unavailable");
    await send({ sender }, "retry");

    expect(runAgent.mock.calls[1]?.[0].messages[0]).toEqual({
      role: "system",
      content: "system:sweet:default->sweet",
    });
  });

  it("rejects unknown styles without saving or changing state", async () => {
    const savePersonaConfig = vi.fn(async () => undefined);
    const deps = createFakeDeps(successfulAgent(), { savePersonaConfig });
    await registerChatIpc(deps);
    const { sender } = createSender();
    const setStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.setStyle)!;
    const getStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.getStyle)!;

    await expect(setStyle({ sender }, "phone")).rejects.toThrow("Invalid persona style: phone");
    await expect(getStyle({ sender })).resolves.toEqual({ styleId: "default" });
    expect(savePersonaConfig).not.toHaveBeenCalled();
  });

  it("keeps in-memory style unchanged when persistence fails", async () => {
    const deps = createFakeDeps(successfulAgent(), {
      savePersonaConfig: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });
    await registerChatIpc(deps);
    const { sender } = createSender();
    const setStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.setStyle)!;
    const getStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.getStyle)!;

    await expect(setStyle({ sender }, "focused")).rejects.toThrow("disk full");
    await expect(getStyle({ sender })).resolves.toEqual({ styleId: "default" });
  });

  it("clears messages while keeping the selected style", async () => {
    const deps = createFakeDeps(successfulAgent());
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;
    const clear = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.clearSession)!;
    const setStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.setStyle)!;
    const getStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.getStyle)!;

    await send({ sender }, "hello");
    await setStyle({ sender }, "lively");

    await expect(clear({ sender })).resolves.toEqual({ cleared: true, messageCount: 0 });
    await expect(getStyle({ sender })).resolves.toEqual({ styleId: "lively" });
  });

  it("creates the tool registry only once", async () => {
    const registry = { getEnabledToolSpecs: () => [] };
    const createToolRegistry = vi.fn(() => registry);
    const runAgent = successfulAgent();
    const deps = createFakeDeps(runAgent, { createToolRegistry });
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;

    await send({ sender }, "first");
    await send({ sender }, "second");

    expect(createToolRegistry).toHaveBeenCalledOnce();
    expect(runAgent.mock.calls[0]?.[0].toolRegistry).toBe(registry);
    expect(runAgent.mock.calls[1]?.[0].toolRegistry).toBe(registry);
  });
});
