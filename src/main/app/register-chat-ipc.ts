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
  createMemoryConflictDetectedEvent,
  createMemoryGovernanceChangedEvent,
  createMemoryResolverFailedEvent,
  createMemoryResolverFinishedEvent,
  createMemoryResolverStartedEvent,
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
  createMemoryConflictService,
  type CreateMemoryConflictServiceOptions,
  type MemoryConflictService,
} from "../memory/memory-conflict-service.js";
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
import { isRecallableL2, type MemoryRecallResult } from "../memory/memory-types.js";
import {
  createMemoryWriteQueue,
  type MemoryWriteQueue,
} from "../memory/memory-write-queue.js";
import {
  applyMemoryResolution,
} from "../memory/memory-resolution-applier.js";
import {
  createMemoryResolver,
  type MemoryResolver,
} from "../memory/memory-resolver.js";
import {
  createMemoryResolverQueue,
  type MemoryResolverQueue,
} from "../memory/memory-resolver-queue.js";
import type { ConflictLog, L2MemoryV2, MemoryEvidence } from "../memory/memory-types.js";
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
  createMemoryConflictService?: (
    options: CreateMemoryConflictServiceOptions,
  ) => MemoryConflictService;
  createMemoryManager?: typeof createMemoryManager;
  memoryWriteQueue?: MemoryWriteQueue;
  memoryResolver?: MemoryResolver;
  memoryResolverQueue?: MemoryResolverQueue;
  buildMemoryContext?: typeof buildDefaultMemoryContext;
}

const RECENT_INJECTION_ROUNDS = 3;

export interface ChatIpcRuntime {
  beginShutdown(): Promise<void>;
  flushBackgroundTasks(): Promise<void>;
  pendingBackgroundTaskCount(): number;
  inspectRestoredMemory?(id: string): Promise<void>;
}

function withoutSystemMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => message.role !== "system");
}

function sendAgentEvent(
  sender: IpcSenderLike | undefined,
  runId: string | undefined,
  agentEvent: AgentEvent,
): void {
  if (!sender || !runId) return;
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

function onlyRecallableL2(result: MemoryRecallResult): MemoryRecallResult {
  return {
    ...result,
    l2: result.l2.filter(({ memory }) => isRecallableL2(memory)),
  };
}

function createSerialExecutor() {
  let tail = Promise.resolve();
  return function serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
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
  const recentInjectionRounds: string[][] = [];
  const conflictService = (deps.createMemoryConflictService ?? createMemoryConflictService)({
    store: memoryStore,
    vectorNeighbors: async (memory, limit) => {
      const recalled = await memoryRecall.recall(memory.content);
      return recalled.l2
        .filter(({ memory: neighbor }) => neighbor.id !== memory.id && isRecallableL2(neighbor))
        .slice(0, limit)
        .map(({ memory: neighbor, score }) => ({ memoryId: neighbor.id, similarity: score }));
    },
    recentInjectionIds: () => [...new Set(recentInjectionRounds.flat())],
  });
  const memoryManager = deps.memoryManager
    ?? (deps.createMemoryManager ?? createMemoryManager)({
      store: memoryStore,
      conflictService,
    });
  const memoryWriteQueue = deps.memoryWriteQueue ?? createMemoryWriteQueue();
  const memoryResolver = deps.memoryResolver ?? createMemoryResolver({ getConfig, adapter });
  const memoryResolverQueue = deps.memoryResolverQueue ?? createMemoryResolverQueue();
  const buildMemoryContext = deps.buildMemoryContext ?? buildDefaultMemoryContext;
  const toolRegistry = getToolRegistry() as ToolRegistry;
  const session = createChatSession(await loadConfig());
  const serializeSessionOperation = createSerialExecutor();
  const acceptedSessionOperations = new Set<Promise<unknown>>();
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | undefined;
  let nextRunNumber = 1;
  const scheduledConflictIds = new Set<string>();

  function runSessionOperation<T>(task: () => Promise<T>): Promise<T> {
    if (shuttingDown) {
      return Promise.reject(new Error("Chat runtime is shutting down"));
    }
    const operation = serializeSessionOperation(task);
    acceptedSessionOperations.add(operation);
    void operation.then(
      () => acceptedSessionOperations.delete(operation),
      () => acceptedSessionOperations.delete(operation),
    );
    return operation;
  }

  function beginShutdown(): Promise<void> {
    shuttingDown = true;
    shutdownPromise ??= (async () => {
      while (acceptedSessionOperations.size > 0) {
        await Promise.allSettled([...acceptedSessionOperations]);
      }
      await flushBackgroundTasks();
    })();
    return shutdownPromise;
  }

  async function flushBackgroundTasks(): Promise<void> {
    await memoryWriteQueue.flush();
    await memoryResolverQueue.flush();
  }

  async function startResolverAttempt(conflictId: string): Promise<{
    conflict: ConflictLog;
    source: L2MemoryV2;
    target: L2MemoryV2;
    sourceEvidence: MemoryEvidence[];
    targetEvidence: MemoryEvidence[];
  } | undefined> {
    let attempt: {
      conflict: ConflictLog;
      source: L2MemoryV2;
      target: L2MemoryV2;
      sourceEvidence: MemoryEvidence[];
      targetEvidence: MemoryEvidence[];
    } | undefined;
    await memoryStore.update((draft) => {
      const conflict = draft.conflictLogs.find((item) => item.id === conflictId);
      if (!conflict || (conflict.status !== "queued" && conflict.status !== "processing")) return;
      const source = draft.l2.find((item) => item.id === conflict.sourceMemoryId);
      const target = draft.l2.find((item) => item.id === conflict.targetMemoryId);
      if (!source || !target || !isRecallableL2(source) || !isRecallableL2(target)) {
        conflict.status = "failed";
        conflict.finishedAt = new Date().toISOString();
        return;
      }
      conflict.status = "processing";
      conflict.attempts += 1;
      attempt = {
        conflict: structuredClone(conflict),
        source: structuredClone(source),
        target: structuredClone(target),
        sourceEvidence: draft.evidence
          .filter((item) => item.memoryId === source.id && source.evidenceIds.includes(item.id))
          .map((item) => structuredClone(item)),
        targetEvidence: draft.evidence
          .filter((item) => item.memoryId === target.id && target.evidenceIds.includes(item.id))
          .map((item) => structuredClone(item)),
      };
    });
    return attempt;
  }

  async function markResolverFailure(conflictId: string): Promise<number> {
    let attempts = 0;
    await memoryStore.update((draft) => {
      const conflict = draft.conflictLogs.find((item) => item.id === conflictId);
      if (!conflict || (conflict.status !== "queued" && conflict.status !== "processing")) return;
      conflict.status = "failed";
      conflict.finishedAt = new Date().toISOString();
      attempts = conflict.attempts;
    });
    return attempts;
  }

  async function markResolverRetryable(conflictId: string): Promise<void> {
    await memoryStore.update((draft) => {
      const conflict = draft.conflictLogs.find((item) => item.id === conflictId);
      if (!conflict || conflict.status !== "processing") return;
      conflict.status = "queued";
      delete conflict.finishedAt;
    });
  }

  function scheduleResolver(
    conflict: ConflictLog,
    sender?: IpcSenderLike,
    runId?: string,
  ): void {
    if (scheduledConflictIds.has(conflict.id)) return;
    scheduledConflictIds.add(conflict.id);
    sendAgentEvent(sender, runId, createMemoryConflictDetectedEvent({
      conflictId: conflict.id,
      queuedCount: memoryResolverQueue.pendingCount() + 1,
    }));
    memoryResolverQueue.schedule({
      id: conflict.id,
      priority: conflict.priority,
      createdAt: conflict.createdAt,
      run: async () => {
        const attempt = await startResolverAttempt(conflict.id);
        if (!attempt) {
          sendAgentEvent(sender, runId, createMemoryResolverFinishedEvent({
            conflictId: conflict.id,
            status: "unchanged",
          }));
          return;
        }
        sendAgentEvent(sender, runId, createMemoryResolverStartedEvent({
          conflictId: conflict.id,
          attempt: attempt.conflict.attempts,
        }));
        const resolution = await memoryResolver.resolve(attempt);
        const applied = await applyMemoryResolution({
          store: memoryStore,
          conflict: attempt.conflict,
          source: attempt.source,
          target: attempt.target,
          sourceEvidenceIds: attempt.sourceEvidence.map((item) => item.id),
          targetEvidenceIds: attempt.targetEvidence.map((item) => item.id),
          resolution,
        });
        if (!applied.applied) {
          await markResolverRetryable(conflict.id);
          throw new Error(`Memory resolution ${applied.code}`);
        }
        const resolved = (await memoryStore.load()).conflictLogs.find((item) => item.id === conflict.id);
        sendAgentEvent(sender, runId, createMemoryResolverFinishedEvent({
          conflictId: conflict.id,
          status: resolved?.status === "uncertain" ? "uncertain" : "resolved",
        }));
        sendAgentEvent(sender, runId, createMemoryGovernanceChangedEvent({ changedCount: 1 }));
      },
      onFinalFailure: async () => {
        const attempts = await markResolverFailure(conflict.id);
        sendAgentEvent(sender, runId, createMemoryResolverFailedEvent({
          conflictId: conflict.id,
          attempts,
        }));
        sendAgentEvent(sender, runId, createMemoryGovernanceChangedEvent({ changedCount: 1 }));
      },
    });
  }

  async function scheduleQueuedResolvers(sender?: IpcSenderLike, runId?: string): Promise<void> {
    const queued = (await memoryStore.load()).conflictLogs
      .filter((conflict) => conflict.status === "queued");
    for (const conflict of queued) scheduleResolver(conflict, sender, runId);
  }

  async function inspectRestoredMemory(id: string): Promise<void> {
    await conflictService.inspectNewMemory(id);
    await scheduleQueuedResolvers();
  }

  deps.ipcMain.handle(
    IPC_CHANNELS.chat.sendMessage,
    async (event, payload): Promise<ChatSendResult> => {
      const text = typeof payload === "string" ? payload : "";
      const runId = `run_${nextRunNumber}`;
      nextRunNumber += 1;
      return runSessionOperation(async () => {
        const history = session.appendUserMessage(text);
        const styleId = session.getStyle();
        const transition = session.getPendingStyleTransition();
        let memoryContext = "";
        sendAgentEvent(event.sender, runId, { type: "memory_recall_started" });
        try {
          const recalledMemory = onlyRecallableL2(await memoryRecall.recall(text));
          recentInjectionRounds.push(recalledMemory.l2.map(({ memory }) => memory.id));
          if (recentInjectionRounds.length > RECENT_INJECTION_ROUNDS) {
            recentInjectionRounds.shift();
          }
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
                onConflictEvent: () => {
                  sendAgentEvent(
                    event.sender,
                    runId,
                    createMemoryWriteFailedEvent("write"),
                  );
                },
              });
              sendAgentEvent(
                event.sender,
                runId,
                createMemoryWriteFinishedEvent(summary),
              );
              if (summary.writtenCount > 0) {
                sendAgentEvent(event.sender, runId, createMemoryGovernanceChangedEvent({
                  changedCount: summary.writtenCount,
                }));
              }
              await scheduleQueuedResolvers(event.sender, runId);
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
      });
    },
  );

  deps.ipcMain.handle(
    IPC_CHANNELS.chat.clearSession,
    async (): Promise<ChatClearResult> => {
      return runSessionOperation(async () => {
        session.clear();
        return {
          cleared: true,
          messageCount: session.getMessages().length,
        };
      });
    },
  );

  deps.ipcMain.handle(
    IPC_CHANNELS.persona.getStyle,
    async (): Promise<PersonaStyleResult> => {
      return runSessionOperation(
        async () => ({ styleId: session.getStyle() }),
      );
    },
  );

  deps.ipcMain.handle(
    IPC_CHANNELS.persona.setStyle,
    async (_event, payload): Promise<PersonaStyleResult> => {
      return runSessionOperation(async () => {
        if (!isStyleId(payload)) {
          throw new Error(`Invalid persona style: ${String(payload)}`);
        }
        await saveConfig({ styleId: payload });
        session.setStyle(payload);
        return { styleId: session.getStyle() };
      });
    },
  );

  return {
    beginShutdown,
    flushBackgroundTasks,
    pendingBackgroundTaskCount: () =>
      acceptedSessionOperations.size
        + memoryWriteQueue.pendingCount()
        + memoryResolverQueue.pendingCount(),
    inspectRestoredMemory,
  };
}
