import { app, BrowserWindow, ipcMain } from "electron";
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
  type MaintenanceRunSummary,
} from "../memory/memory-maintenance.js";
import { createMemoryResolverQueue } from "../memory/memory-resolver-queue.js";
import { MemoryScheduler } from "../memory/memory-scheduler.js";
import { createMemoryStore } from "../memory/memory-store.js";
import {
  createMemoryGovernanceChangedEvent,
  createMemoryMaintenanceFailedEvent,
  createMemoryMaintenanceFinishedEvent,
  createMemoryMaintenanceStartedEvent,
  type AgentEvent,
} from "../agent/agent-events.js";
import type { ChatAgentEventPayload } from "../../shared/electron-api.js";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";

async function boot(): Promise<void> {
  await app.whenReady();
  const memoryStore = createMemoryStore();
  const governance = createMemoryGovernanceService({ store: memoryStore });
  const resolverQueue = createMemoryResolverQueue();
  const coordinator = new MaintenanceCoordinator({
    store: memoryStore,
    resolverQueue,
    decayService: new MemoryDecayService({ store: memoryStore }),
    l1ExpiryService: new MemoryL1Expiry({ store: memoryStore }),
    audit: () => governance.audit(),
  });
  let nextMaintenanceEventNumber = 1;
  const memoryScheduler = new MemoryScheduler({
    store: memoryStore,
    coordinator: {
      initialize: () => coordinator.initialize(),
      runNow: async (reason) => {
        const runId = `memory_maintenance_${nextMaintenanceEventNumber++}`;
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
    memoryResolverQueue: resolverQueue,
    memoryScheduler,
  });
  const memoryRuntime = registerMemoryIpc({
    ipcMain,
    governance,
    memoryScheduler,
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
  const changedCount = decay.weightUpdated + l1Expired;
  if (changedCount > 0) {
    broadcastAgentEvent(runId, createMemoryGovernanceChangedEvent({ changedCount }));
  }
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
