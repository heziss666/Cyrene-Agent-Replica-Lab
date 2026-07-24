import { app, BrowserWindow, dialog, ipcMain, Notification } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { registerBackgroundMemoryShutdown } from "./background-memory-shutdown.js";
import { createMainWindow } from "./create-window.js";
import { registerChatIpc } from "./register-chat-ipc.js";
import {
  combineIpcShutdownRuntimes,
  registerMemoryIpc,
} from "./register-memory-ipc.js";
import { createMemoryGovernanceService } from "../memory/memory-governance.js";
import { MemoryDecayService, type LifecycleCounts } from "../memory/memory-decay-service.js";
import { MemoryL1Expiry } from "../memory/memory-l1-expiry.js";
import {
  MaintenanceCoordinator,
  type MaintenanceStepName,
  type MaintenanceRunSummary,
} from "../memory/memory-maintenance.js";
import { createMemoryResolverQueue } from "../memory/memory-resolver-queue.js";
import { MemoryScheduler } from "../memory/memory-scheduler.js";
import { createMemoryStore } from "../memory/memory-store.js";
import { createMemoryReflection } from "../memory/memory-reflection.js";
import { createMemoryReflectionVerifier } from "../memory/memory-reflection-verifier.js";
import { MemoryProfilePromoter } from "../memory/memory-profile-promoter.js";
import { createMemoryCompressor } from "../memory/memory-compressor.js";
import { createMemoryCompressionVerifier } from "../memory/memory-compression-verifier.js";
import { MemoryCompressionService } from "../memory/memory-compression-service.js";
import { MemorySummarySync } from "../memory/memory-summary-sync.js";
import { EntityGraphService } from "../memory/entity-graph.js";
import { MemoryIntelligenceService } from "../memory/memory-intelligence-service.js";
import { createMemoryRecallService } from "../memory/memory-recall.js";
import { createOllamaEmbeddingProvider } from "../rag/ollama-embedding-provider.js";
import { loadEmbeddingConfig } from "../config/embedding-config.js";
import { loadRagStorageConfig } from "../config/rag-storage-config.js";
import { createJsonVectorIndex } from "../rag/json-vector-index.js";
import { VECTOR_INDEX_SCHEMA_VERSION } from "../rag/vector-index-types.js";
import { DEFAULT_CHUNK_SIZE_CHARS, DEFAULT_OVERLAP_CHARS } from "../rag/chunk-text.js";
import {
  createRuntimeToolRegistry,
  loadRuntimeModelConfig,
} from "../runtime/agent-runtime.js";
import { openAICompatibleAdapter } from "../vendors/openai-compatible.js";
import {
  countMemoryGovernanceChanges,
  createMemoryGovernanceChangedEvent,
  createMemoryMaintenanceFailedEvent,
  createMemoryMaintenanceFinishedEvent,
  createMemoryMaintenanceStartedEvent,
  createMemoryIntelligenceFinishedEvent,
  type AgentEvent,
} from "../agent/agent-events.js";
import type { ChatAgentEventPayload } from "../../shared/electron-api.js";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import { registerSkillsIpc } from "./register-skills-ipc.js";
import {
  createSkillRuntime,
  defaultBuiltinSkillsRoot,
} from "../skills/create-skill-runtime.js";
import { registerSkillTools } from "../skills/skill-tools.js";
import { createMcpRuntime } from "../mcp/create-mcp-runtime.js";
import type { McpApprovalRequest } from "../mcp/mcp-permission.js";
import { registerMcpIpc } from "./register-mcp-ipc.js";
import { registerSchedulerIpc } from "./register-scheduler-ipc.js";
import { createSchedulerRuntime } from "../scheduler/create-scheduler-runtime.js";
import { createScheduledAgentRunner } from "../scheduler/scheduled-agent-runner.js";
import { createPromptComposer } from "../prompts/prompt-composer.js";
import { loadPersonaConfig } from "../config/persona-config.js";
import { buildSkillCatalog } from "../skills/skill-catalog.js";
import { buildMemoryContext } from "../memory/memory-context.js";
import { loadConversationConfig } from "../config/conversation-config.js";
import { createConversationStore } from "../conversations/conversation-store.js";
import { createConversationService } from "../conversations/conversation-service.js";
import { createConversationVectorIndex } from "../context/conversation-vector-index.js";
import { createConversationHistoryRetriever } from "../context/conversation-history-retriever.js";
import { createConversationSummarizer } from "../context/conversation-summarizer.js";
import { createConservativeTokenEstimator } from "../context/token-estimator.js";
import { createContextManager } from "../context/context-manager.js";
import { registerConversationIpc } from "./register-conversation-ipc.js";
import { createAgentRunStore } from "../runs/agent-run-store.js";
import { createAgentRunManager } from "../runs/agent-run-manager.js";
import { loadAgentRunConfig } from "../config/run-config.js";
import { registerRunsIpc } from "./register-runs-ipc.js";
import type { AgentRunEventEnvelope } from "../runs/agent-run-types.js";
import { loadCurrencyWarRuntime } from "../currency-war/data/currency-war-runtime-loader.js";
import { createCurrencyWarRuntime } from "../currency-war/currency-war-runtime.js";
import { createCurrencyWarGameStore } from "../currency-war/games/currency-war-game-store.js";
import { createCurrencyWarGameService } from "../currency-war/games/currency-war-game-service.js";
import { registerCurrencyWarGamesIpc } from "./register-currency-war-games-ipc.js";
import { createCurrencyWarFactService } from "../currency-war/grounding/currency-war-facts.js";
import { registerCurrencyWarTools } from "../currency-war/grounding/currency-war-tools.js";
import { createCurrencyWarGroundingBuilder } from "../currency-war/grounding/currency-war-grounding.js";
import { createCurrencyWarGuidanceRetriever } from "../currency-war/rag/currency-war-guidance-retriever.js";

async function boot(): Promise<void> {
  await app.whenReady();
  const baseToolRegistry = createRuntimeToolRegistry();
  const currencyWarRuntime = createCurrencyWarRuntime(await loadCurrencyWarRuntime());
  const currencyWarFacts = createCurrencyWarFactService(currencyWarRuntime);
  registerCurrencyWarTools(baseToolRegistry, currencyWarFacts);
  const userData = app.getPath("userData");
  const runConfig = loadAgentRunConfig();
  const agentRunStore = createAgentRunStore({ rootDir: join(userData, "agent-runs") });
  await agentRunStore.initialize();
  const agentRunManager = createAgentRunManager({
    store: agentRunStore,
    maxConcurrent: runConfig.maxConcurrent,
    runTimeoutMs: runConfig.runTimeoutMs,
    onEvent: (event) => {
      broadcastRunEvent(event);
      broadcastRunsChanged();
    },
  });
  const runsIpcRuntime = registerRunsIpc({
    ipcMain,
    manager: agentRunManager,
    selectExportPath: async (runId) => {
      const result = await dialog.showSaveDialog({
        defaultPath: `${runId}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      return result.canceled ? undefined : result.filePath;
    },
    writeExport: (path, content) => writeFile(path, content, "utf8"),
  });
  const skillRuntime = await createSkillRuntime({
    builtinRoot: app.isPackaged
      ? join(process.resourcesPath, "skills")
      : defaultBuiltinSkillsRoot(),
    userRoot: join(userData, "skills"),
    settingsPath: join(userData, "skills-settings.json"),
    toolIds: baseToolRegistry.getAllTools().map((tool) => tool.id),
  });
  registerSkillTools(baseToolRegistry, skillRuntime.registry);
  const mcpRuntime = createMcpRuntime({
    configPath: join(userData, "mcp-servers.json"),
    registry: baseToolRegistry,
    emitApproval: broadcastMcpApproval,
    onEvent: (event) => broadcastAgentEvent("mcp", event),
  });
  await mcpRuntime.manager.initialize();
  const memoryStore = createMemoryStore();
  const governance = createMemoryGovernanceService({ store: memoryStore });
  const resolverQueue = createMemoryResolverQueue();
  const embeddingProvider = createOllamaEmbeddingProvider(loadEmbeddingConfig());
  const storage = loadRagStorageConfig();
  const currencyWarGuidance = createCurrencyWarGuidanceRetriever({ embeddingProvider });
  const currencyWarGrounding = createCurrencyWarGroundingBuilder({
    facts: currencyWarFacts,
    skills: skillRuntime.registry,
    guidance: currencyWarGuidance,
  });
  const vectorIndex = createJsonVectorIndex({ filePath: join(storage.dataDir, "memory-vector-index.json"), identity: { providerId: embeddingProvider.id, model: embeddingProvider.model, schemaVersion: VECTOR_INDEX_SCHEMA_VERSION }, chunkSizeChars: DEFAULT_CHUNK_SIZE_CHARS, overlapChars: DEFAULT_OVERLAP_CHARS });
  const entityGraph = new EntityGraphService();
  const reflection = createMemoryReflection({ getConfig: loadRuntimeModelConfig, adapter: openAICompatibleAdapter });
  const reflectionVerifier = createMemoryReflectionVerifier({ getConfig: loadRuntimeModelConfig, adapter: openAICompatibleAdapter });
  const summarySync = new MemorySummarySync({ store: memoryStore, embeddingProvider, vectorIndex });
  const compression = new MemoryCompressionService({ store: memoryStore, embeddingProvider, compressor: createMemoryCompressor({ getConfig: loadRuntimeModelConfig, adapter: openAICompatibleAdapter }), verifier: createMemoryCompressionVerifier({ getConfig: loadRuntimeModelConfig, adapter: openAICompatibleAdapter }), summarySync });
  const intelligence = new MemoryIntelligenceService({ store: memoryStore, reflection, verifier: reflectionVerifier, promoter: new MemoryProfilePromoter({ store: memoryStore }), compression, entityGraph });
  const coordinator = new MaintenanceCoordinator({
    store: memoryStore,
    resolverQueue,
    decayService: new MemoryDecayService({ store: memoryStore }),
    l1ExpiryService: new MemoryL1Expiry({ store: memoryStore }),
    reflection: () => intelligence.reflectAndPromote(),
    compression: () => intelligence.compress(),
    entityGraph: () => intelligence.rebuildEntityGraph(),
    audit: () => governance.audit(),
  });
  const memoryScheduler = new MemoryScheduler({
    store: memoryStore,
    coordinator: {
      initialize: () => coordinator.initialize(),
      runNow: async (reason, runId) => {
        broadcastAgentEvent(runId, createMemoryMaintenanceStartedEvent({ pendingCount: 1 }));
        try {
          const summary = await coordinator.runNow(reason);
          broadcastMaintenanceResult(runId, summary);
          return summary;
        } catch {
          broadcastAgentEvent(runId, createMemoryMaintenanceFailedEvent({ failedStepCount: 1 }));
          throw new Error("MEMORY_MAINTENANCE_FAILED");
        }
      },
    },
  });
  const memoryRecall = createMemoryRecallService({ store: memoryStore, embeddingProvider, vectorIndex });
  const conversationConfig = loadConversationConfig(process.env, userData);
  const currencyWarGameStore = createCurrencyWarGameStore({
    rootDir: join(userData, "currency-war", "games"),
  });
  const currencyWarGameService = createCurrencyWarGameService({
    store: currencyWarGameStore,
    catalog: currencyWarRuntime.catalog,
  });
  await currencyWarGameService.initialize();
  const conversationStore = createConversationStore({ rootDir: conversationConfig.rootDir });
  const conversationService = createConversationService({ store: conversationStore });
  const defaultPersona = await loadPersonaConfig();
  await conversationService.initialize(defaultPersona.styleId);
  const conversationVectorIndex = createConversationVectorIndex({
    filePath: join(conversationConfig.rootDir, "conversation-vector-index.json"),
    providerId: embeddingProvider.id,
    model: embeddingProvider.model,
  });
  await conversationVectorIndex.initialize();
  const conversationHistoryRetriever = createConversationHistoryRetriever({
    provider: embeddingProvider,
    index: conversationVectorIndex,
  });
  const tokenEstimator = createConservativeTokenEstimator();
  const conversationSummarizer = createConversationSummarizer({
    estimator: tokenEstimator,
    triggerTokens: conversationConfig.summaryTriggerTokens,
    recentTurnTokens: conversationConfig.recentTurnTokens,
    getConfig: loadRuntimeModelConfig,
    adapter: openAICompatibleAdapter,
  });
  const contextManager = createContextManager({
    estimator: tokenEstimator,
    historyRetriever: conversationHistoryRetriever,
    contextWindowTokens: conversationConfig.contextWindowTokens,
    outputReserveTokens: conversationConfig.outputReserveTokens,
    toolGrowthReserveTokens: conversationConfig.toolGrowthReserveTokens,
    recentTurnTokens: conversationConfig.recentTurnTokens,
    summaryTriggerTokens: conversationConfig.summaryTriggerTokens,
  });
  const conversationIpcRuntime = registerConversationIpc({
    ipcMain,
    service: conversationService,
    getDefaultStyle: () => defaultPersona.styleId,
  });
  const currencyWarGamesIpcRuntime = registerCurrencyWarGamesIpc({
    ipcMain,
    service: currencyWarGameService,
  });
  const chatRuntime = await registerChatIpc({
    ipcMain,
    skillRegistry: skillRuntime.registry,
    currencyWarGrounding,
    createToolRegistry: () => mcpRuntime.manager.createToolRegistrySnapshot(),
    memoryStore,
    memoryRecall,
    memoryResolverQueue: resolverQueue,
    memoryScheduler,
    conversationService,
    contextManager,
    conversationSummarizer,
    conversationHistoryRetriever,
    agentRunManager,
  });
  const memoryRuntime = registerMemoryIpc({
    ipcMain,
    governance,
    memoryScheduler,
    entityGraph,
    afterRestoreL2: async (id, context) => {
      await chatRuntime.inspectRestoredMemory?.(id, context.sender, context.runId);
    },
  });
  const skillsIpcRuntime = registerSkillsIpc({
    ipcMain,
    registry: skillRuntime.registry,
  });
  const mcpIpcRuntime = registerMcpIpc({
    ipcMain,
    manager: mcpRuntime.manager,
    approvalBroker: mcpRuntime.approvalBroker,
  });
  const promptComposer = createPromptComposer();
  const scheduledRunner = createScheduledAgentRunner({
    timeoutMs: runConfig.schedulerRunTimeoutMs,
    composeSystemPrompt: async (taskPrompt) => {
      const persona = await loadPersonaConfig();
      let memoryContext = "";
      try { memoryContext = buildMemoryContext(await memoryRecall.recall(taskPrompt)); } catch { /* Run without memory. */ }
      return [
        promptComposer.composeSystemPrompt({ styleId: persona.styleId }),
        buildSkillCatalog(skillRuntime.registry.list()),
        memoryContext,
        "## Scheduled execution\nThis is an isolated scheduled task. Complete the task and report the result. Sensitive MCP tools require interactive approval; if approval is unavailable, explain what needs attention.",
      ].filter((part) => part.trim()).join("\n\n---\n\n");
    },
    createToolRegistry: () => mcpRuntime.manager.createToolRegistrySnapshot(),
    getModelConfig: loadRuntimeModelConfig,
    adapter: openAICompatibleAdapter,
    onEvent: broadcastAgentEvent,
    agentRunManager,
  });
  const schedulerRuntime = createSchedulerRuntime({
    dataDir: join(userData, "scheduler"),
    runner: scheduledRunner,
    onChanged: broadcastSchedulerChanged,
    onEvent: (event) => broadcastAgentEvent("scheduler", event),
    onRunFinished: (run, task) => {
      if (!Notification.isSupported()) return;
      new Notification({
        title: task.name,
        body: run.status === "succeeded" ? "Scheduled task completed" : `Scheduled task: ${run.status}`,
      }).show();
    },
  });
  await schedulerRuntime.initialize();
  const schedulerIpcRuntime = registerSchedulerIpc({ ipcMain, scheduler: schedulerRuntime });
  app.once("will-quit", () => skillsIpcRuntime.dispose());
  app.once("will-quit", () => mcpIpcRuntime.dispose());
  app.once("will-quit", () => schedulerIpcRuntime.dispose());
  app.once("will-quit", () => conversationIpcRuntime.dispose());
  app.once("will-quit", () => currencyWarGamesIpcRuntime.dispose());
  app.once("will-quit", () => runsIpcRuntime.dispose());
  const backgroundRuntime = combineIpcShutdownRuntimes(chatRuntime, memoryRuntime, mcpRuntime, schedulerRuntime);
  const runtime = {
    beginShutdown: async () => {
      await backgroundRuntime.beginShutdown();
      await agentRunManager.beginShutdown();
      await conversationService.flush();
      await currencyWarGameService.flush();
    },
    flushBackgroundTasks: async () => {
      await backgroundRuntime.flushBackgroundTasks();
      await agentRunManager.flush();
      await conversationService.flush();
      await currencyWarGameService.flush();
    },
    pendingBackgroundTaskCount: () =>
      backgroundRuntime.pendingBackgroundTaskCount() + agentRunManager.pendingCount(),
  };
  registerBackgroundMemoryShutdown({ app, runtime });
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
}

function broadcastMaintenanceResult(runId: string, summary: MaintenanceRunSummary): void {
  if (summary.errorCodes.length > 0) {
    broadcastAgentEvent(
      runId,
      createMemoryMaintenanceFailedEvent({ failedStepCount: summary.errorCodes.length }),
    );
    return;
  }
  const decay = lifecycleCounts(summary.steps.decay);
  const l1Expired = expiredFieldCount(summary.steps["l1-expiry"]);
  broadcastAgentEvent(runId, createMemoryMaintenanceFinishedEvent({ ...decay, l1Expired }));
  broadcastAgentEvent(runId, createMemoryIntelligenceFinishedEvent(intelligenceCounts(summary)));
  const changedCount = countMemoryGovernanceChanges({ ...decay, l1Expired });
  if (changedCount > 0) {
    broadcastAgentEvent(runId, createMemoryGovernanceChangedEvent({ changedCount }));
  }
}

function intelligenceCounts(summary: MaintenanceRunSummary) {
  const reflection = stepValue(summary.steps.reflection);
  const compression = stepValue(summary.steps.compression);
  const graph = stepValue(summary.steps["entity-graph"]);
  return {
    proposedCount: numericCount(reflection?.proposedCount),
    acceptedCount: numericCount(reflection?.acceptedCount),
    skippedCount: numericCount(reflection?.skippedCount),
    compressedCount: numericCount(compression?.compressed),
    nodeCount: numericCount(graph?.nodeCount),
    relationCount: numericCount(graph?.relationCount),
  };
}

function stepValue(step: MaintenanceRunSummary["steps"][MaintenanceStepName]): Record<string, unknown> | undefined {
  return step && "ok" in step && isRecord(step.value) ? step.value : undefined;
}

function lifecycleCounts(step: MaintenanceRunSummary["steps"]["decay"]): LifecycleCounts {
  if (!step || !("ok" in step) || !isRecord(step.value)) {
    return { activeToAging: 0, agingToArchived: 0, weightUpdated: 0 };
  }
  return {
    activeToAging: numericCount(step.value.activeToAging),
    agingToArchived: numericCount(step.value.agingToArchived),
    weightUpdated: numericCount(step.value.weightUpdated),
  };
}

function expiredFieldCount(step: MaintenanceRunSummary["steps"]["l1-expiry"]): number {
  if (!step || !("ok" in step) || !isRecord(step.value)) return 0;
  return Array.isArray(step.value.expiredFields) ? step.value.expiredFields.length : 0;
}

function numericCount(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function broadcastAgentEvent(runId: string, event: AgentEvent): void {
  const payload: ChatAgentEventPayload = { runId, event };
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      window.webContents.send(IPC_CHANNELS.chat.agentEvent, payload);
    } catch {
      // A renderer can close while maintenance is still draining.
    }
  }
}

function broadcastMcpApproval(request: McpApprovalRequest): boolean {
  let delivered = false;
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      window.webContents.send(IPC_CHANNELS.mcp.approvalRequest, request);
      delivered = true;
    } catch {
      // A window can close while an approval request is being broadcast.
    }
  }
  return delivered;
}

function broadcastSchedulerChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    try { window.webContents.send(IPC_CHANNELS.scheduler.changed); } catch { /* Window closed. */ }
  }
}

function broadcastRunEvent(event: AgentRunEventEnvelope): void {
  for (const window of BrowserWindow.getAllWindows()) {
    try { window.webContents.send(IPC_CHANNELS.runs.event, event); } catch { /* Window closed. */ }
  }
}

function broadcastRunsChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    try { window.webContents.send(IPC_CHANNELS.runs.changed, { runs: [] }); } catch { /* Window closed. */ }
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

boot().catch(() => {
  console.error("[electron] failed to start");
  app.quit();
});
