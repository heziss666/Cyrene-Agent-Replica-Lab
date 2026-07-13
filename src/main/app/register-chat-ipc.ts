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
import {
  createMemoryWriteFailedEvent,
  createMemoryWriteFinishedEvent,
  type AgentEvent,
} from "../agent/agent-events.js";
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
import {
  buildMemoryContext as buildDefaultMemoryContext,
} from "../memory/memory-context.js";
import {
  createMemoryJudge,
  type MemoryJudge,
} from "../memory/memory-judge.js";
import {
  createMemoryManager,
  type MemoryManager,
} from "../memory/memory-manager.js";
import {
  createMemoryRecallService,
  type MemoryRecallService,
} from "../memory/memory-recall.js";
import {
  createMemoryStore,
  type MemoryStore,
} from "../memory/memory-store.js";
import type { MemoryRecallResult } from "../memory/memory-types.js";
import {
  createMemoryWriteQueue,
  type MemoryWriteQueue,
} from "../memory/memory-write-queue.js";
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
  memoryStore?: MemoryStore;
  memoryRecall?: MemoryRecallService;
  memoryJudge?: MemoryJudge;
  memoryManager?: MemoryManager;
  memoryWriteQueue?: MemoryWriteQueue;
  buildMemoryContext?: typeof buildDefaultMemoryContext;
}

export interface ChatIpcRuntime {
  flushBackgroundTasks(): Promise<void>;
  pendingBackgroundTaskCount(): number;
}

function withoutSystemMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => message.role !== "system");
}

function sendAgentEvent(
  sender: IpcSenderLike,
  runId: string,
  agentEvent: AgentEvent,
): void {
  try {
    sender.send(IPC_CHANNELS.chat.agentEvent, { runId, event: agentEvent });
  } catch {
    // The renderer may disappear while a chat or background write is running.
  }
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function includesL0Memory(result: MemoryRecallResult): boolean {
  return hasText(result.l0.preferredName)
    || hasText(result.l0.occupation)
    || result.l0.longTermInterests.some(hasText)
    || hasText(result.l0.language)
    || result.l0.permanentNotes.some(hasText);
}

function includesL1Memory(result: MemoryRecallResult): boolean {
  return hasText(result.l1.currentProject)
    || result.l1.recentGoals.some(hasText)
    || result.l1.recentPreferences.some(hasText);
}

export async function registerChatIpc(
  deps: RegisterChatIpcDeps,
): Promise<ChatIpcRuntime> {
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
  const memoryStore = deps.memoryStore ?? createMemoryStore();
  const memoryRecall = deps.memoryRecall
    ?? createMemoryRecallService({ store: memoryStore });
  const memoryJudge = deps.memoryJudge
    ?? createMemoryJudge({ getConfig, adapter });
  const memoryManager = deps.memoryManager
    ?? createMemoryManager({ store: memoryStore });
  const memoryWriteQueue = deps.memoryWriteQueue ?? createMemoryWriteQueue();
  const buildMemoryContext = deps.buildMemoryContext ?? buildDefaultMemoryContext;
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
      const styleId = session.getStyle();
      const transition = session.getPendingStyleTransition();
      let memoryContext = "";
      sendAgentEvent(event.sender, runId, { type: "memory_recall_started" });
      try {
        const recalledMemory = await memoryRecall.recall(text);
        memoryContext = buildMemoryContext(recalledMemory);
        sendAgentEvent(event.sender, runId, {
          type: "memory_recall_finished",
          l0Included: includesL0Memory(recalledMemory),
          l1Included: includesL1Memory(recalledMemory),
          l2Count: recalledMemory.l2.length,
          mode: recalledMemory.retrievalMode ?? "vector",
        });
      } catch (error) {
        sendAgentEvent(
          event.sender,
          runId,
          createMemoryWriteFailedEvent("recall", error),
        );
      }
      const personaPrompt = promptComposer.composeSystemPrompt({
        styleId,
        transition,
      });
      const systemMessage: ChatMessage = {
        role: "system",
        content: memoryContext.trim().length > 0
          ? `${personaPrompt}\n\n---\n\n${memoryContext}`
          : personaPrompt,
      };
      const result: ToolAgentResult = await runAgent({
        messages: [systemMessage, ...history],
        config: getConfig(),
        adapter,
        toolRegistry,
        onEvent: (agentEvent: AgentEvent) => {
          sendAgentEvent(event.sender, runId, agentEvent);
        },
      });
      const persistedMessages = withoutSystemMessages(result.messages);
      session.replaceMessages(persistedMessages);
      session.acknowledgeStyleTransition(transition);

      try {
        memoryWriteQueue.schedule(async () => {
          let candidates;
          sendAgentEvent(event.sender, runId, { type: "memory_judge_started" });
          try {
            candidates = await memoryJudge.judge({
              userMessage: text,
              assistantReply: result.reply,
            });
            sendAgentEvent(event.sender, runId, {
              type: "memory_judge_finished",
              candidateCount: candidates.length,
            });
          } catch (error) {
            sendAgentEvent(
              event.sender,
              runId,
              createMemoryWriteFailedEvent("judge", error),
            );
            return;
          }

          try {
            const summary = await memoryManager.writeCandidates({
              userMessage: text,
              candidates,
            });
            sendAgentEvent(
              event.sender,
              runId,
              createMemoryWriteFinishedEvent(summary),
            );
          } catch (error) {
            sendAgentEvent(
              event.sender,
              runId,
              createMemoryWriteFailedEvent("write", error),
            );
          }
        }, (error) => {
          sendAgentEvent(
            event.sender,
            runId,
            createMemoryWriteFailedEvent("write", error),
          );
        });
        sendAgentEvent(event.sender, runId, {
          type: "memory_write_scheduled",
          pendingCount: memoryWriteQueue.pendingCount(),
        });
      } catch (error) {
        sendAgentEvent(
          event.sender,
          runId,
          createMemoryWriteFailedEvent("write", error),
        );
      }

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

  return {
    flushBackgroundTasks: () => memoryWriteQueue.flush(),
    pendingBackgroundTaskCount: () => memoryWriteQueue.pendingCount(),
  };
}
