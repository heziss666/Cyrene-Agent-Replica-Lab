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

type IpcHandler = (event: IpcEvent, text?: string) => Promise<unknown>;

interface FakeIpcMain {
  handlers: Map<string, IpcHandler>;
  handle: (channel: string, handler: IpcHandler) => void;
}

type RegisterChatIpcDeps = Parameters<typeof registerChatIpc>[0];
type FakeRegisterChatIpcDeps = Omit<RegisterChatIpcDeps, "ipcMain"> & {
  ipcMain: FakeIpcMain;
};

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
    handle: (channel, handler) => {
      handlers.set(channel, handler);
    },
  };
}

function createFakeDeps(
  runAgent: ReturnType<typeof vi.fn>,
): FakeRegisterChatIpcDeps {
  return {
    ipcMain: createFakeIpcMain(),
    runAgent,
    createInitialHistory: () => [{ role: "system", content: "system" }],
    createConfig: () => config,
    createToolRegistry: () => ({
      getEnabledToolSpecs: () => [],
    }),
    adapter: {
      id: "fake",
      buildRequest: vi.fn(),
      parseResponse: vi.fn(),
      appendToolResults: vi.fn(),
    },
  };
}

function createSender() {
  const sentEvents: Array<{ channel: string; payload: ChatAgentEventPayload }> = [];
  return {
    sentEvents,
    sender: {
      send: vi.fn((channel: string, payload: ChatAgentEventPayload) => {
        sentEvents.push({ channel, payload });
      }),
    },
  };
}

describe("registerChatIpc", () => {
  it("returns run metadata and forwards agent events with the current run id", async () => {
    const runAgent = vi.fn(async ({ onEvent }: { onEvent?: (event: AgentEvent) => void }) => {
      onEvent?.({
        type: "run_started",
        inputMessageCount: 2,
        maxRounds: 5,
      });

      return {
        reply: "hello from agent",
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "hello" },
          { role: "assistant", content: "hello from agent" },
        ] satisfies ChatMessage[],
        toolResults: [],
      };
    });
    const deps = createFakeDeps(runAgent);
    registerChatIpc(deps);
    const { sender, sentEvents } = createSender();

    const handler = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage);
    const result = await handler?.({ sender }, "hello");

    expect(sentEvents).toEqual([
      {
        channel: IPC_CHANNELS.chat.agentEvent,
        payload: {
          runId: "run_1",
          event: {
            type: "run_started",
            inputMessageCount: 2,
            maxRounds: 5,
          },
        },
      },
    ]);
    expect(result).toEqual({
      reply: "hello from agent",
      runId: "run_1",
      messageCount: 3,
      toolResultCount: 0,
    });
  });

  it("keeps message history across multiple send-message calls", async () => {
    const runAgent = vi
      .fn()
      .mockImplementationOnce(async () => ({
        reply: "first reply",
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "first" },
          { role: "assistant", content: "first reply" },
        ] satisfies ChatMessage[],
        toolResults: [],
      }))
      .mockImplementationOnce(async () => ({
        reply: "second reply",
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "first" },
          { role: "assistant", content: "first reply" },
          { role: "user", content: "second" },
          { role: "assistant", content: "second reply" },
        ] satisfies ChatMessage[],
        toolResults: [],
      }));
    const deps = createFakeDeps(runAgent);
    registerChatIpc(deps);
    const { sender } = createSender();
    const handler = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;

    await handler({ sender }, "first");
    await handler({ sender }, "second");

    expect(runAgent.mock.calls[1]?.[0].messages).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "first" },
      { role: "assistant", content: "first reply" },
      { role: "user", content: "second" },
    ]);
  });

  it("reuses one tool registry across multiple messages", async () => {
    const registry = { getEnabledToolSpecs: () => [] };
    const createToolRegistry = vi.fn(() => registry);
    const runAgent = vi.fn(async ({
      messages,
    }: {
      messages: ChatMessage[];
      toolRegistry: unknown;
    }) => ({
      reply: "reply",
      messages: [...messages, { role: "assistant" as const, content: "reply" }],
      toolResults: [],
    }));
    const deps = createFakeDeps(runAgent);
    deps.createToolRegistry = createToolRegistry;
    registerChatIpc(deps);
    const { sender } = createSender();
    const handler = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;

    await handler({ sender }, "first");
    await handler({ sender }, "second");

    expect(createToolRegistry).toHaveBeenCalledOnce();
    expect(runAgent.mock.calls[0]?.[0].toolRegistry).toBe(registry);
    expect(runAgent.mock.calls[1]?.[0].toolRegistry).toBe(registry);
  });

  it("clears session history through the clear-session channel", async () => {
    const runAgent = vi
      .fn()
      .mockImplementationOnce(async () => ({
        reply: "first reply",
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "first" },
          { role: "assistant", content: "first reply" },
        ] satisfies ChatMessage[],
        toolResults: [],
      }))
      .mockImplementationOnce(async () => ({
        reply: "after clear reply",
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "after clear" },
          { role: "assistant", content: "after clear reply" },
        ] satisfies ChatMessage[],
        toolResults: [],
      }));
    const deps = createFakeDeps(runAgent);
    registerChatIpc(deps);
    const { sender } = createSender();
    const sendHandler = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;
    const clearHandler = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.clearSession)!;

    await sendHandler({ sender }, "first");
    const clearResult = await clearHandler({ sender });
    await sendHandler({ sender }, "after clear");

    expect(clearResult).toEqual({ cleared: true, messageCount: 1 });
    expect(runAgent.mock.calls[1]?.[0].messages).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "after clear" },
    ]);
  });
});
