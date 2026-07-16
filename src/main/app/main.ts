import { app, BrowserWindow, ipcMain } from "electron";
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
import { loadRuntimeModelConfig } from "../runtime/agent-runtime.js";
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

async function boot(): Promise<void> {
  await app.whenReady();
  const memoryStore = createMemoryStore();
  const governance = createMemoryGovernanceService({ store: memoryStore });
  const resolverQueue = createMemoryResolverQueue();
  const embeddingProvider = createOllamaEmbeddingProvider(loadEmbeddingConfig());
  const storage = loadRagStorageConfig();
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
  const chatRuntime = await registerChatIpc({
    ipcMain,
    memoryStore,
    memoryRecall: createMemoryRecallService({ store: memoryStore, embeddingProvider, vectorIndex }),
    memoryResolverQueue: resolverQueue,
    memoryScheduler,
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
  const runtime = combineIpcShutdownRuntimes(chatRuntime, memoryRuntime);
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

boot().catch(() => {
  console.error("[electron] failed to start");
  app.quit();
});
