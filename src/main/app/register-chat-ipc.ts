import type { ChatMessage } from "../../shared/chat-types.js";
import type {
  ChatAgentEventPayload,
  ChatClearResult,
  ChatSendResult,
  PersonaStyleResult,
} from "../../shared/electron-api.js";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import { isStyleId } from "../../shared/persona-types.js";
import {
  createRuntimeToolRegistry,
  loadRuntimeModelConfig,
} from "../../cli/chat.js";
import type { AgentEvent } from "../agent/agent-events.js";
import type { ToolAgentResult } from "../agent/tool-agent.js";
import { runToolAgent } from "../agent/tool-agent.js";
import { createChatSession } from "../chat/chat-session.js";
import {
  defaultPersonaConfigPath,
  loadPersonaConfig,
  savePersonaConfig,
  type PersonaConfig,
} from "../config/persona-config.js";
import {
  createPromptComposer,
  type PromptComposer,
} from "../prompts/prompt-composer.js";
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
    handler: (event: { sender: IpcSenderLike }, payload?: unknown) => Promise<unknown>,
  ) => void;
}

export interface RegisterChatIpcDeps {
  ipcMain: IpcMainLike;
  runAgent?: typeof runToolAgent;
  createConfig?: () => ModelConfig;
  createToolRegistry?: () => ToolRegistry | Pick<ToolRegistry, "getEnabledToolSpecs">;
  createPromptComposer?: () => PromptComposer;
  loadPersonaConfig?: () => Promise<PersonaConfig>;
  savePersonaConfig?: (config: PersonaConfig) => Promise<void>;
  adapter?: VendorAdapter;
}

function withoutSystemMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => message.role !== "system");
}

export async function registerChatIpc(deps: RegisterChatIpcDeps): Promise<void> {
  const runAgent = deps.runAgent ?? runToolAgent;
  const getConfig = deps.createConfig ?? loadRuntimeModelConfig;
  const getToolRegistry = deps.createToolRegistry ?? createRuntimeToolRegistry;
  const promptComposer = (deps.createPromptComposer ?? createPromptComposer)();
  const personaConfigPath = defaultPersonaConfigPath();
  const loadConfig = deps.loadPersonaConfig
    ?? (() => loadPersonaConfig(personaConfigPath));
  const saveConfig = deps.savePersonaConfig
    ?? ((config: PersonaConfig) => savePersonaConfig(personaConfigPath, config));
  const adapter = deps.adapter ?? openAICompatibleAdapter;
  const toolRegistry = getToolRegistry() as ToolRegistry;
  const session = createChatSession(await loadConfig());
  let nextRunNumber = 1;

  deps.ipcMain.handle(
    IPC_CHANNELS.chat.sendMessage,
    async (event, payload): Promise<ChatSendResult> => {
      const text = typeof payload === "string" ? payload : "";
      const runId = `run_${nextRunNumber}`;
      nextRunNumber += 1;
      const history = session.appendUserMessage(text);
      const transition = session.getPendingStyleTransition();
      const systemMessage: ChatMessage = {
        role: "system",
        content: promptComposer.composeSystemPrompt({
          styleId: session.getStyle(),
          transition,
        }),
      };
      const result: ToolAgentResult = await runAgent({
        messages: [systemMessage, ...history],
        config: getConfig(),
        adapter,
        toolRegistry,
        onEvent: (agentEvent: AgentEvent) => {
          event.sender.send(IPC_CHANNELS.chat.agentEvent, { runId, event: agentEvent });
        },
      });
      const persistedMessages = withoutSystemMessages(result.messages);
      session.replaceMessages(persistedMessages);
      session.acknowledgeStyleTransition(transition);

      return {
        reply: result.reply,
        runId,
        messageCount: persistedMessages.length,
        toolResultCount: result.toolResults.length,
      };
    },
  );

  deps.ipcMain.handle(
    IPC_CHANNELS.chat.clearSession,
    async (): Promise<ChatClearResult> => {
      session.clear();
      return {
        cleared: true,
        messageCount: session.getMessages().length,
      };
    },
  );

  deps.ipcMain.handle(
    IPC_CHANNELS.persona.getStyle,
    async (): Promise<PersonaStyleResult> => ({ styleId: session.getStyle() }),
  );

  deps.ipcMain.handle(
    IPC_CHANNELS.persona.setStyle,
    async (_event, payload): Promise<PersonaStyleResult> => {
      if (!isStyleId(payload)) {
        throw new Error(`Invalid persona style: ${String(payload)}`);
      }
      await saveConfig({ styleId: payload });
      session.setStyle(payload);
      return { styleId: session.getStyle() };
    },
  );
}
