import type { ChatMessage } from "../../shared/chat-types.js";
import type {
  ChatAgentEventPayload,
  ChatClearResult,
  ChatRunAcceptedResult,
  ChatSendResult,
  PersonaStyleResult,
} from "../../shared/electron-api.js";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import { isStyleId } from "../../shared/persona-types.js";
import type { ConversationSendInput } from "../../shared/conversation-types.js";
import {
  createRuntimeToolRegistry,
  loadRuntimeModelConfig,
} from "../runtime/agent-runtime.js";
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
import type { ConversationService } from "../conversations/conversation-service.js";
import { toChatMessages } from "../conversations/conversation-types.js";
import type { ContextManager } from "../context/context-manager.js";
import type { ConversationSummarizer } from "../context/conversation-summarizer.js";
import type { ConversationHistoryRetriever } from "../context/conversation-history-retriever.js";
import type {
  AgentRunExecutionContext,
  AgentRunManager,
} from "../runs/agent-run-manager.js";

const CHAT_ID = /^[A-Za-z0-9_.-]{1,200}$/u;

export function parseConversationSendInput(payload: unknown): ConversationSendInput {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)
    || Object.getPrototypeOf(payload) !== Object.prototype) {
    throw new Error("Invalid chat IPC payload");
  }
  const keys = Reflect.ownKeys(payload);
  if (keys.length !== 3 || !keys.includes("conversationId") || !keys.includes("requestId") || !keys.includes("text")) {
    throw new Error("Invalid chat IPC payload");
  }
  const value = payload as Record<string, unknown>;
  if (typeof value.conversationId !== "string" || !CHAT_ID.test(value.conversationId)
    || typeof value.requestId !== "string" || !CHAT_ID.test(value.requestId)
    || typeof value.text !== "string" || !value.text.trim()) {
    throw new Error("Invalid chat IPC payload");
  }
  return { conversationId: value.conversationId, requestId: value.requestId, text: value.text };
}
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
import { MemoryAccessService } from "../memory/memory-access-service.js";
import { RecentMemoryTracker } from "../memory/recent-memory-tracker.js";
import {
  createMemoryStore,
  type MemoryStore,
} from "../memory/memory-store.js";
import { isRecallableL2, type MemoryRecallResult } from "../memory/memory-types.js";
import {
  createMemoryWriteQueue,
  type MemoryWriteQueue,
} from "../memory/memory-write-queue.js";
import type { MemoryScheduler } from "../memory/memory-scheduler.js";
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
import { buildSkillCatalog } from "../skills/skill-catalog.js";
import { parseSkillCommand } from "../skills/skill-command.js";
import type { SkillRegistry } from "../skills/skill-registry.js";
import type { CurrencyWarGroundingBuilder } from "../currency-war/grounding/currency-war-grounding.js";

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
  memoryAccessService?: Pick<MemoryAccessService, "recordInjected">;
  recentMemoryTracker?: RecentMemoryTracker;
  memoryJudge?: MemoryJudge;
  memoryManager?: MemoryManager;
  createMemoryConflictService?: (
    options: CreateMemoryConflictServiceOptions,
  ) => MemoryConflictService;
  createMemoryManager?: typeof createMemoryManager;
  memoryWriteQueue?: MemoryWriteQueue;
  memoryResolver?: MemoryResolver;
  memoryResolverQueue?: MemoryResolverQueue;
  memoryScheduler?: Pick<MemoryScheduler, "recordSuccessfulWrite">;
  buildMemoryContext?: typeof buildDefaultMemoryContext;
  skillRegistry?: Pick<
    SkillRegistry,
    "list" | "get" | "readBody" | "readReference"
  >;
  currencyWarGrounding?: CurrencyWarGroundingBuilder;
  conversationService?: ConversationService;
  contextManager?: ContextManager;
  conversationSummarizer?: ConversationSummarizer;
  conversationHistoryRetriever?: ConversationHistoryRetriever;
  agentRunManager?: AgentRunManager;
}

export interface ChatIpcRuntime {
  closeAcceptance?(): Promise<void>;
  beginShutdown(): Promise<void>;
  flushBackgroundTasks(): Promise<void>;
  pendingBackgroundTaskCount(): number;
  inspectRestoredMemory?(id: string, sender?: IpcSenderLike, runId?: string): Promise<void>;
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
    const identity = runConversationIdentities.get(runId);
    sender.send(IPC_CHANNELS.chat.agentEvent, { runId, ...identity, event: agentEvent });
  } catch {
    // The renderer may disappear while a chat or background write is running.
  }
}

const runConversationIdentities = new Map<string, { conversationId: string; requestId: string }>();

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
  const getToolRegistry = deps.createToolRegistry
    ?? (() => createRuntimeToolRegistry(deps.skillRegistry));
  const promptComposer = (deps.createPromptComposer ?? createPromptComposer)();
  const personaConfigPath = defaultPersonaConfigPath();
  const loadConfig = deps.loadPersonaConfig
    ?? (() => loadPersonaConfig(personaConfigPath));
  const saveConfig = deps.savePersonaConfig
    ?? ((config: PersonaConfig) => savePersonaConfig(personaConfigPath, config));
  const adapter = deps.adapter ?? openAICompatibleAdapter;
  const memoryStore = deps.memoryStore ?? createMemoryStore();
  const recentMemoryTracker = deps.recentMemoryTracker ?? new RecentMemoryTracker();
  const memoryRecall = deps.memoryRecall
    ?? createMemoryRecallService({ store: memoryStore, recentMemoryTracker });
  const memoryAccessService = deps.memoryAccessService
    ?? new MemoryAccessService({ store: memoryStore });
  const memoryJudge = deps.memoryJudge
    ?? createMemoryJudge({ getConfig, adapter });
  const conflictService = (deps.createMemoryConflictService ?? createMemoryConflictService)({
    store: memoryStore,
    vectorNeighbors: async (memory, limit) => {
      const recalled = await memoryRecall.recall(memory.content);
      return recalled.l2
        .filter(({ memory: neighbor }) => neighbor.id !== memory.id && isRecallableL2(neighbor))
        .slice(0, limit)
        .map(({ memory: neighbor, score }) => ({ memoryId: neighbor.id, similarity: score }));
    },
    recentInjectionIds: () => [
      ...new Set(recentMemoryTracker.snapshot().flatMap(({ ids }) => ids)),
    ],
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
  const session = createChatSession(await loadConfig());
  const serializeSessionOperation = createSerialExecutor();
  const acceptedSessionOperations = new Set<Promise<unknown>>();
  const conversationBackgroundTasks = new Set<Promise<unknown>>();
  let shuttingDown = false;
  let acceptanceClosedPromise: Promise<void> | undefined;
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

  function closeAcceptance(): Promise<void> {
    shuttingDown = true;
    acceptanceClosedPromise ??= (async () => {
      while (acceptedSessionOperations.size > 0) {
        await Promise.allSettled([...acceptedSessionOperations]);
      }
    })();
    return acceptanceClosedPromise;
  }

  function beginShutdown(): Promise<void> {
    shutdownPromise ??= closeAcceptance().then(() => flushBackgroundTasks());
    return shutdownPromise;
  }

  async function flushBackgroundTasks(): Promise<void> {
    await memoryWriteQueue.flush();
    await memoryResolverQueue.flush();
    await Promise.allSettled([...conversationBackgroundTasks]);
    await deps.conversationService?.flush();
    await deps.conversationHistoryRetriever?.flush();
  }

  function scheduleConversationBackground(task: () => Promise<void>): void {
    const operation = task();
    conversationBackgroundTasks.add(operation);
    void operation.finally(() => conversationBackgroundTasks.delete(operation));
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

  async function inspectRestoredMemory(
    id: string,
    sender?: IpcSenderLike,
    runId?: string,
  ): Promise<void> {
    await conflictService.inspectNewMemory(id);
    sendAgentEvent(sender, runId, createMemoryGovernanceChangedEvent({ changedCount: 1 }));
    await scheduleQueuedResolvers(sender, runId);
  }

  async function handleChatMessage(
    event: { sender: IpcSenderLike },
    payload: unknown,
    managed?: AgentRunExecutionContext,
  ): Promise<ChatSendResult | ChatRunAcceptedResult> {
      const persistentInput = typeof payload === "string"
        ? undefined
        : parseConversationSendInput(payload);
      if (persistentInput && (!deps.conversationService || !deps.contextManager)) {
        throw new Error("CONVERSATION_RUNTIME_NOT_CONFIGURED");
      }
      if (deps.agentRunManager && persistentInput && !managed) {
        return deps.agentRunManager.submit({
          source: "chat",
          conversationId: persistentInput.conversationId,
          requestId: persistentInput.requestId,
          execute: async (context) => {
            await handleChatMessage(event, payload, context);
          },
        });
      }
      const rawText = persistentInput?.text ?? (typeof payload === "string" ? payload : "");
      const runId = managed?.runId ?? `run_${nextRunNumber}`;
      if (!managed) nextRunNumber += 1;
      if (persistentInput) {
        runConversationIdentities.set(runId, {
          conversationId: persistentInput.conversationId,
          requestId: persistentInput.requestId,
        });
      }
      const execute = async (): Promise<ChatSendResult> => {
        const command = deps.skillRegistry
          ? parseSkillCommand(rawText, deps.skillRegistry.list())
          : { kind: "none" as const, text: rawText };
        if (command.kind === "error") throw new Error(command.code);
        const text = command.text;
        let manualSkillPrompt = "";
        if (command.kind === "activated") {
          try {
            manualSkillPrompt = [
              `## Activated Skill: ${command.skillId}`,
              await deps.skillRegistry!.readBody(command.skillId),
            ].join("\n\n");
            sendAgentEvent(event.sender, runId, {
              type: "skill_activated",
              skillId: command.skillId,
            });
          } catch (error) {
            const code = error instanceof Error && /^SKILL_[A-Z_]+$/.test(error.message)
              ? error.message
              : "SKILL_LOAD_FAILED";
            sendAgentEvent(event.sender, runId, {
              type: "skill_load_failed",
              skillId: command.skillId,
              code,
            });
            throw new Error(code);
          }
        }
        let pendingSaved = false;
        let streamedText = "";
        try {
        let persistentRecord;
        let history: ChatMessage[];
        if (persistentInput) {
          persistentRecord = await deps.conversationService!.appendPendingUserMessage({
            conversationId: persistentInput.conversationId,
            requestId: persistentInput.requestId,
            text,
            tokenEstimate: 0,
          });
          pendingSaved = true;
          history = toChatMessages(persistentRecord.messages);
        } else {
          history = session.appendUserMessage(text);
        }
        const styleId = persistentRecord?.styleId ?? session.getStyle();
        const transition = persistentRecord?.pendingStyleTransition ?? session.getPendingStyleTransition();
        let memoryContext = "";
        let injectedL2Ids: string[] | undefined;
        sendAgentEvent(event.sender, runId, { type: "memory_recall_started" });
        try {
          const recalledMemory = onlyRecallableL2(await memoryRecall.recall(text));
          memoryContext = buildMemoryContext(recalledMemory);
          injectedL2Ids = recalledMemory.l2
            .filter(({ memory }) => hasText(memory.content))
            .map(({ memory }) => memory.id);
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
        let currencyWarContext = "";
        if (deps.currencyWarGrounding) {
          try {
            currencyWarContext = await deps.currencyWarGrounding.build(text);
          } catch {
            currencyWarContext = [
              "## 货币战争证据状态",
              "本轮货币战争证据不可用。",
              "禁止陈述具体游戏事实；只能说明无法完成可靠查证，并请用户稍后重试。",
            ].join("\n");
          }
        }
        const personaPrompt = promptComposer.composeSystemPrompt({
          styleId,
          transition,
        });
        const skillCatalog = deps.skillRegistry
          ? buildSkillCatalog(deps.skillRegistry.list())
          : "";
        const promptParts = [
          personaPrompt,
          skillCatalog,
          manualSkillPrompt,
          currencyWarContext,
          memoryContext,
        ].filter((part) => part.trim().length > 0);
        const systemMessage: ChatMessage = {
          role: "system",
          content: promptParts.join("\n\n---\n\n"),
        };
        const toolRegistry = getToolRegistry() as ToolRegistry;
        const agentMessages = persistentInput
          ? (await deps.contextManager!.build({
            record: persistentRecord!,
            systemPrompt: systemMessage.content,
            tools: toolRegistry.getEnabledToolSpecs(),
            currentRequestId: persistentInput.requestId,
          })).messages
          : [systemMessage, ...history];
        let streamStarted = false;
        let lastCheckpointAt = 0;
        let checkpointTail = Promise.resolve();
        if (managed && persistentInput) {
          persistentRecord = await deps.conversationService!.startAssistantStream(
            persistentInput.conversationId,
            persistentInput.requestId,
          );
          streamStarted = true;
        }
        const checkpoint = (force = false): void => {
          if (!streamStarted || !persistentInput) return;
          const timestamp = Date.now();
          if (!force && timestamp - lastCheckpointAt < 1000) return;
          lastCheckpointAt = timestamp;
          const content = streamedText;
          checkpointTail = checkpointTail.then(async () => {
            await deps.conversationService!.checkpointAssistantStream(
              persistentInput.conversationId,
              persistentInput.requestId,
              content,
            );
          });
        };
        const result: ToolAgentResult = await runAgent({
          messages: agentMessages,
          config: getConfig(),
          adapter,
          toolRegistry,
          stream: Boolean(managed),
          signal: managed?.signal,
          onTextDelta: managed ? (delta) => {
            streamedText += delta;
            managed.emit("text_delta", { delta });
            checkpoint();
          } : undefined,
          onEvent: (agentEvent: AgentEvent) => {
            sendAgentEvent(event.sender, runId, agentEvent);
            managed?.emit("agent_event", { agentEvent });
          },
        });
        if (streamStarted) {
          checkpoint(true);
          await checkpointTail;
        }
        managed?.recordUsage({
          inputTokens: Math.ceil(JSON.stringify(agentMessages).length / 4),
          outputTokens: Math.ceil(result.reply.length / 4),
          source: "estimated",
        });
        const persistedMessages = withoutSystemMessages(result.messages);
        let finalMessageCount: number;
        let finalizedConversation = persistentRecord;
        if (persistentInput) {
          const generatedMessages = result.messages.slice(agentMessages.length);
          finalizedConversation = await deps.conversationService!.completeRun(
            persistentInput.conversationId,
            persistentInput.requestId,
            generatedMessages,
          );
          await deps.conversationService!.acknowledgeStyleTransition(
            persistentInput.conversationId,
            transition,
          );
          finalMessageCount = finalizedConversation.messages.length;
        } else {
          session.replaceMessages(persistedMessages);
          session.acknowledgeStyleTransition(transition);
          finalMessageCount = persistedMessages.length;
        }

        if (injectedL2Ids) {
          recentMemoryTracker.recordInjected(runId, injectedL2Ids);
          if (injectedL2Ids.length > 0) {
            try {
              const ids = [...injectedL2Ids];
              memoryWriteQueue.schedule(async () => {
                await memoryAccessService.recordInjected(ids);
              }, (error) => {
                sendAgentEvent(
                  event.sender,
                  runId,
                  createMemoryWriteFailedEvent("write", error),
                );
              });
            } catch (error) {
              sendAgentEvent(
                event.sender,
                runId,
                createMemoryWriteFailedEvent("write", error),
              );
            }
          }
        }

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
                try {
                  await deps.memoryScheduler?.recordSuccessfulWrite();
                } catch (error) {
                  sendAgentEvent(
                    event.sender,
                    runId,
                    createMemoryWriteFailedEvent("write", error),
                  );
                }
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

        if (persistentInput && finalizedConversation) {
          const record = finalizedConversation;
          scheduleConversationBackground(async () => {
            await deps.conversationHistoryRetriever?.indexConversation(record);
            if (deps.conversationSummarizer?.shouldSummarize(record)) {
              const summary = await deps.conversationSummarizer.summarize(record);
              if (summary.status === "updated") {
                await deps.conversationService!.updateSummary(record.id, summary.summary);
              }
            }
          });
        }

        return {
          reply: result.reply,
          runId,
          conversationId: persistentInput?.conversationId,
          requestId: persistentInput?.requestId,
          messageCount: finalMessageCount,
          toolResultCount: result.toolResults.length,
        };
        } catch (error) {
          if (persistentInput && pendingSaved) {
            if (managed?.signal.aborted) {
              await deps.conversationService!.checkpointAssistantStream(
                persistentInput.conversationId,
                persistentInput.requestId,
                typeof streamedText === "string" ? streamedText : "",
              ).catch(() => undefined);
              await deps.conversationService!.finishAssistantStream(
                persistentInput.conversationId,
                persistentInput.requestId,
                "cancelled",
              ).catch(() => undefined);
            } else {
              await deps.conversationService!.failRun(
                persistentInput.conversationId,
                persistentInput.requestId,
              ).catch(async () => {
                await deps.conversationService!.finishAssistantStream(
                  persistentInput.conversationId,
                  persistentInput.requestId,
                  "failed",
                ).catch(() => undefined);
              });
            }
          }
          throw error;
        }
      };
      return managed ? execute() : runSessionOperation(execute);
  }

  deps.ipcMain.handle(
    IPC_CHANNELS.chat.sendMessage,
    (event, payload) => handleChatMessage(event, payload),
  );

  deps.ipcMain.handle(
    IPC_CHANNELS.chat.clearSession,
    async (): Promise<ChatClearResult> => {
      return runSessionOperation(async () => {
        session.clear();
        recentMemoryTracker.clear();
        return {
          cleared: true,
          messageCount: session.getMessages().length,
        };
      });
    },
  );

  deps.ipcMain.handle(
    IPC_CHANNELS.persona.getStyle,
    async (_event, payload): Promise<PersonaStyleResult> => {
      return runSessionOperation(
        async () => {
          if (payload === undefined) return { styleId: session.getStyle() };
          const conversationId = parseConversationIdPayload(payload);
          if (!deps.conversationService) throw new Error("CONVERSATION_RUNTIME_NOT_CONFIGURED");
          return { styleId: (await deps.conversationService.get(conversationId)).styleId };
        },
      );
    },
  );

  deps.ipcMain.handle(
    IPC_CHANNELS.persona.setStyle,
    async (_event, payload): Promise<PersonaStyleResult> => {
      return runSessionOperation(async () => {
        if (typeof payload === "object" && payload !== null) {
          const value = payload as Record<string, unknown>;
          if (Reflect.ownKeys(value).length !== 2 || typeof value.conversationId !== "string"
            || !CHAT_ID.test(value.conversationId) || !isStyleId(value.styleId)) {
            throw new Error(`Invalid persona style: ${String(value.styleId)}`);
          }
          if (!deps.conversationService) throw new Error("CONVERSATION_RUNTIME_NOT_CONFIGURED");
          return { styleId: (await deps.conversationService.setStyle(value.conversationId, value.styleId)).styleId };
        }
        if (!isStyleId(payload)) throw new Error(`Invalid persona style: ${String(payload)}`);
        await saveConfig({ styleId: payload });
        session.setStyle(payload);
        return { styleId: session.getStyle() };
      });
    },
  );

  return {
    closeAcceptance,
    beginShutdown,
    flushBackgroundTasks,
    pendingBackgroundTaskCount: () =>
      acceptedSessionOperations.size
        + memoryWriteQueue.pendingCount()
        + memoryResolverQueue.pendingCount()
        + conversationBackgroundTasks.size,
    inspectRestoredMemory,
  };
}

function parseConversationIdPayload(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)
    || Reflect.ownKeys(payload).length !== 1) throw new Error("Invalid persona payload");
  const conversationId = (payload as Record<string, unknown>).conversationId;
  if (typeof conversationId !== "string" || !CHAT_ID.test(conversationId)) {
    throw new Error("Invalid persona payload");
  }
  return conversationId;
}
