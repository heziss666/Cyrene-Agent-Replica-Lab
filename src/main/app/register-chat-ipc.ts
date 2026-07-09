import type { ChatMessage } from "../../shared/chat-types.js";
import type {
  ChatAgentEventPayload,
  ChatClearResult,
  ChatSendResult,
} from "../../shared/electron-api.js";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import type { AgentEvent } from "../agent/agent-events.js";
import type { ToolAgentResult } from "../agent/tool-agent.js";
import { runToolAgent } from "../agent/tool-agent.js";
import { createChatSession } from "../chat/chat-session.js";
import { loadRuntimeModelConfig, createInitialHistory, createRuntimeToolRegistry } from "../../cli/chat.js";
import { openAICompatibleAdapter } from "../vendors/openai-compatible.js";
import type { ModelConfig } from "../config/model-config.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import type { VendorAdapter } from "../vendors/types.js";

export interface IpcSenderLike {
  send: (channel: string, payload: ChatAgentEventPayload) => void;
}

export interface IpcMainLike {
  handle: (
    channel: string,
    handler: (event: { sender: IpcSenderLike }, text?: string) => Promise<unknown>,
  ) => void;
}

export interface RegisterChatIpcDeps {
  ipcMain: IpcMainLike;
  runAgent?: typeof runToolAgent;
  createInitialHistory?: () => ChatMessage[];
  createConfig?: () => ModelConfig;
  createToolRegistry?: () => ToolRegistry | Pick<ToolRegistry, "getEnabledToolSpecs">;
  adapter?: VendorAdapter;
}

export function registerChatIpc(deps: RegisterChatIpcDeps): void {
  const runAgent = deps.runAgent ?? runToolAgent;
  const getInitialHistory = deps.createInitialHistory ?? createInitialHistory;
  const getConfig = deps.createConfig ?? loadRuntimeModelConfig;
  const getToolRegistry = deps.createToolRegistry ?? createRuntimeToolRegistry;
  const adapter = deps.adapter ?? openAICompatibleAdapter;
  const session = createChatSession(getInitialHistory());
  let nextRunNumber = 1;

  deps.ipcMain.handle(IPC_CHANNELS.chat.sendMessage, async (event, text = ""): Promise<ChatSendResult> => {
    const runId = `run_${nextRunNumber}`;
    nextRunNumber += 1;
    const messages = session.appendUserMessage(text);
    const result: ToolAgentResult = await runAgent({
      messages,
      config: getConfig(),
      adapter,
      toolRegistry: getToolRegistry() as ToolRegistry,
      onEvent: (agentEvent) => {
        event.sender.send(IPC_CHANNELS.chat.agentEvent, { runId, event: agentEvent });
      },
    });
    session.replaceMessages(result.messages);

    return {
      reply: result.reply,
      runId,
      messageCount: result.messages.length,
      toolResultCount: result.toolResults.length,
    };
  });

  deps.ipcMain.handle(IPC_CHANNELS.chat.clearSession, async (): Promise<ChatClearResult> => {
    session.clear();
    return {
      cleared: true,
      messageCount: session.getMessages().length,
    };
  });
}
