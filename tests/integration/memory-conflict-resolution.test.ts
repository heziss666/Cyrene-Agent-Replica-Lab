import { describe, expect, it, vi } from "vitest";
import { registerChatIpc, type IpcSenderLike } from "../../src/main/app/register-chat-ipc.js";
import { registerMemoryIpc, type MemoryIpcEventLike } from "../../src/main/app/register-memory-ipc.js";
import type { AgentEvent } from "../../src/main/agent/agent-events.js";
import { createMemoryGovernanceService } from "../../src/main/memory/memory-governance.js";
import type { MemoryStore } from "../../src/main/memory/memory-store.js";
import type { L2MemoryV2, MemoryCandidate, MemoryFile, MemoryRecallResult } from "../../src/main/memory/memory-types.js";
import { createEmptyMemoryFileV2 } from "../../src/main/memory/memory-types.js";
import type { MemoryResolution, MemoryResolver } from "../../src/main/memory/memory-resolver.js";
import { createMemoryResolverQueue } from "../../src/main/memory/memory-resolver-queue.js";
import { createMemoryWriteQueue } from "../../src/main/memory/memory-write-queue.js";
import type { ChatMessage } from "../../src/shared/chat-types.js";
import type { ChatAgentEventPayload } from "../../src/shared/electron-api.js";
import { IPC_CHANNELS } from "../../src/shared/ipc-channels.js";

const config = { provider: "deepseek", baseUrl: "https://api.example.test", model: "test", apiKey: "sk-test" };
const OLD_ID = "memory-old";
const OLD_CONTENT = "I prefer dark mode";
const NEW_CONTENT = "I now prefer light mode";

type IpcHandler = (event: { sender: { send(channel: string, payload: ChatAgentEventPayload): void } }, payload?: unknown) => Promise<unknown>;

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function memory(id: string, content: string, createdAt: string, pinned = false): L2MemoryV2 {
  return {
    id, content, confidence: 0.9, importance: "high", evidenceIds: [`evidence-${id}`],
    createdAt, updatedAt: createdAt, lastAccessedAt: createdAt, accessCount: 0, weight: 0.8,
    isPinned: pinned, isEnabled: true, status: "active", syncStatus: "synced", isSummary: false,
    sourceMemoryIds: [], sourceSnapshots: [], conflictWith: [],
  };
}

function candidate(): MemoryCandidate {
  return {
    layer: "L2", content: NEW_CONTENT, confidence: 0.96, importance: "high",
    evidenceQuote: NEW_CONTENT, reason: "new preference",
  };
}

function createStore(pinned = false): { store: MemoryStore; read(): MemoryFile } {
  let file: MemoryFile = {
    ...createEmptyMemoryFileV2(),
    l2: [memory(OLD_ID, OLD_CONTENT, "2026-07-15T00:00:00.000Z", pinned)],
    evidence: [{ id: `evidence-${OLD_ID}`, memoryId: OLD_ID, quote: OLD_CONTENT, capturedAt: "2026-07-15T00:00:00.000Z", source: "conversation", sourceMemoryIds: [] }],
  };
  return {
    store: {
      load: async () => structuredClone(file),
      update: async (mutator) => {
        const draft = structuredClone(file);
        mutator(draft);
        file = draft;
        return structuredClone(file);
      },
    },
    read: () => structuredClone(file),
  };
}

function createRuntimeFixture(options: { resolver: MemoryResolver; pinned?: boolean }) {
  const memoryFile = createStore(options.pinned);
  const handlers = new Map<string, IpcHandler>();
  const sender = { send: vi.fn<(channel: string, payload: ChatAgentEventPayload) => void>() };
  const memoryRecall = {
    recall: vi.fn(async (query: string): Promise<MemoryRecallResult> => {
      const file = memoryFile.read();
      const l2 = query === NEW_CONTENT
        ? file.l2.filter((row) => row.id === OLD_ID).map((row) => ({ memory: row, score: 0.95 }))
        : file.l2.map((row) => ({ memory: row, score: 0.95 }));
      return { l0: file.l0, l1: file.l1, l2, retrievalMode: "vector" };
    }),
  };
  const runAgent = vi.fn(async ({ messages, onEvent }: { messages: ChatMessage[]; onEvent?: (event: AgentEvent) => void }) => {
    onEvent?.({ type: "final_reply", round: 1, text: "acknowledged" });
    return { reply: "acknowledged", messages: [...messages, { role: "assistant" as const, content: "acknowledged" }], toolResults: [] };
  });
  const runtime = registerChatIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    runAgent,
    createConfig: () => config,
    createToolRegistry: () => ({ getEnabledToolSpecs: () => [] }),
    createPromptComposer: () => ({ composeSystemPrompt: () => "system" }),
    loadPersonaConfig: async () => ({ styleId: "default" }),
    savePersonaConfig: async () => undefined,
    adapter: { id: "fake", buildRequest: vi.fn(), parseResponse: vi.fn(), appendToolResults: vi.fn() },
    memoryStore: memoryFile.store,
    memoryRecall,
    memoryJudge: { judge: vi.fn(async () => [candidate()]) },
    memoryWriteQueue: createMemoryWriteQueue(),
    memoryResolver: options.resolver,
    memoryResolverQueue: createMemoryResolverQueue(),
  });
  return { runtime, memoryFile, memoryRecall, runAgent, sender, handlers };
}

async function sendPreference(fixture: ReturnType<typeof createRuntimeFixture>) {
  const runtime = await fixture.runtime;
  const send = fixture.handlers.get(IPC_CHANNELS.chat.sendMessage)!;
  await send({ sender: fixture.sender }, NEW_CONTENT);
  await runtime.flushBackgroundTasks();
  return runtime;
}

describe("memory conflict resolution integration", () => {
  it("evolves a preference, excludes the superseded memory from recall, and emits safe lifecycle events", async () => {
    const resolver: MemoryResolver = { resolve: async (input): Promise<MemoryResolution> => ({
      resolutionType: "preference_evolution", sourceMemoryId: input.source.id, targetMemoryId: input.target.id,
      status: "resolved", confidence: 0.93, reason: "newer preference", actions: ["supersede_target"],
    }) };
    const fixture = createRuntimeFixture({ resolver });
    await sendPreference(fixture);

    const file = fixture.memoryFile.read();
    const old = file.l2.find((row) => row.id === OLD_ID)!;
    const current = file.l2.find((row) => row.id !== OLD_ID)!;
    expect(old).toMatchObject({ status: "superseded", isEnabled: false, supersededBy: current.id });
    expect(current).toMatchObject({ content: NEW_CONTENT, status: "active", isEnabled: true });
    expect(file.conflictLogs).toMatchObject([{ status: "resolved", resolutionType: "preference_evolution", resolutionConfidence: 0.93 }]);
    const send = fixture.handlers.get(IPC_CHANNELS.chat.sendMessage)!;
    await send({ sender: fixture.sender }, "follow-up");
    expect(fixture.runAgent.mock.calls[1]?.[0].messages[0]?.content).toContain(NEW_CONTENT);
    expect(fixture.runAgent.mock.calls[1]?.[0].messages[0]?.content).not.toContain(OLD_CONTENT);
    const events = fixture.sender.send.mock.calls.map(([, payload]) => payload.event);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "memory_conflict_detected", "memory_resolver_started", "memory_resolver_finished", "memory_governance_changed",
    ]));
    expect(JSON.stringify(events)).not.toContain(NEW_CONTENT);
    expect(JSON.stringify(events)).not.toContain(OLD_CONTENT);
  });

  it("keeps both active when the strict resolver fails", async () => {
    const fixture = createRuntimeFixture({ resolver: { resolve: vi.fn(async () => { throw new Error("model leaked detail"); }) } });
    await sendPreference(fixture);

    const file = fixture.memoryFile.read();
    expect(file.l2.map((row) => row.status)).toEqual(["active", "active"]);
    expect(file.conflictLogs).toMatchObject([{ status: "failed", attempts: 3 }]);
    const events = fixture.sender.send.mock.calls.map(([, payload]) => payload.event);
    expect(events.map((event) => event.type)).toContain("memory_resolver_failed");
    expect(JSON.stringify(events)).not.toContain("model leaked detail");
  });

  it("marks preference evolution uncertain when the old memory is pinned", async () => {
    const resolver: MemoryResolver = { resolve: async (input): Promise<MemoryResolution> => ({
      resolutionType: "preference_evolution", sourceMemoryId: input.source.id, targetMemoryId: input.target.id,
      status: "resolved", confidence: 0.93, reason: "newer preference", actions: ["supersede_target"],
    }) };
    const fixture = createRuntimeFixture({ resolver, pinned: true });
    await sendPreference(fixture);

    const file = fixture.memoryFile.read();
    expect(file.l2.map((row) => row.status)).toEqual(["active", "active"]);
    expect(file.conflictLogs).toMatchObject([{ status: "uncertain", resolutionType: "uncertain" }]);
  });

  it.each([
    ["pins", async (fixture: ReturnType<typeof createRuntimeFixture>) => {
      const conflict = fixture.memoryFile.read().conflictLogs[0]!;
      await fixture.memoryFile.store.update((draft) => {
        draft.l2.find((row) => row.id === conflict.targetMemoryId)!.isPinned = true;
      });
    }, "uncertain"],
    ["disables", async (fixture: ReturnType<typeof createRuntimeFixture>) => {
      const conflict = fixture.memoryFile.read().conflictLogs[0]!;
      await fixture.memoryFile.store.update((draft) => {
        draft.l2.find((row) => row.id === conflict.targetMemoryId)!.isEnabled = false;
      });
    }, "failed"],
    ["edits", async (fixture: ReturnType<typeof createRuntimeFixture>) => {
      const conflict = fixture.memoryFile.read().conflictLogs[0]!;
      await fixture.memoryFile.store.update((draft) => {
        draft.l2.find((row) => row.id === conflict.targetMemoryId)!.content = "I prefer monochrome mode";
      });
    }, "resolved"],
  ])("does not strand a resolver in processing when concurrent governance %s a conflict memory", async (_name, mutate, expectedStatus) => {
    const started = createDeferred<void>();
    const finish = createDeferred<MemoryResolution>();
    const resolver: MemoryResolver = { resolve: vi.fn(async (input) => {
      started.resolve();
      return finish.promise;
    }) };
    const fixture = createRuntimeFixture({ resolver });
    const runtime = await fixture.runtime;
    const send = fixture.handlers.get(IPC_CHANNELS.chat.sendMessage)!;
    await send({ sender: fixture.sender }, NEW_CONTENT);
    await started.promise;
    await mutate(fixture);
    const conflict = fixture.memoryFile.read().conflictLogs[0]!;
    const source = fixture.memoryFile.read().l2.find((row) => row.id === conflict.sourceMemoryId)!;
    const target = fixture.memoryFile.read().l2.find((row) => row.id === conflict.targetMemoryId)!;
    finish.resolve({
      resolutionType: "preference_evolution",
      sourceMemoryId: source.id,
      targetMemoryId: target.id,
      status: "resolved",
      confidence: 0.93,
      reason: "newer preference",
      actions: ["supersede_target"],
    });
    await runtime.flushBackgroundTasks();

    expect(fixture.memoryFile.read().conflictLogs[0]).toMatchObject({
      status: expectedStatus,
    });
    expect(fixture.memoryFile.read().conflictLogs[0]?.status).not.toBe("processing");
  });

  it("fails invalid resolver output instead of leaving the conflict processing", async () => {
    const fixture = createRuntimeFixture({
      resolver: {
        resolve: async (input): Promise<MemoryResolution> => ({
          resolutionType: "preference_evolution",
          sourceMemoryId: input.target.id,
          targetMemoryId: input.source.id,
          status: "resolved",
          confidence: 0.93,
          reason: "invalid pairing",
          actions: ["supersede_target"],
        }),
      },
    });
    await sendPreference(fixture);

    expect(fixture.memoryFile.read().conflictLogs).toMatchObject([{
      status: "failed",
      attempts: 3,
    }]);
  });

  it("drains an accepted resolver operation through the single shutdown barrier", async () => {
    const started = createDeferred<void>();
    const finish = createDeferred<MemoryResolution>();
    const resolver: MemoryResolver = { resolve: vi.fn(async (input) => {
      started.resolve();
      return finish.promise;
    }) };
    const fixture = createRuntimeFixture({ resolver });
    const runtime = await fixture.runtime;
    const send = fixture.handlers.get(IPC_CHANNELS.chat.sendMessage)!;
    await send({ sender: fixture.sender }, NEW_CONTENT);
    await started.promise;

    let drained = false;
    const shutdown = runtime.beginShutdown().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    const conflict = fixture.memoryFile.read().conflictLogs[0]!;
    const source = fixture.memoryFile.read().l2.find((row) => row.id === conflict.sourceMemoryId)!;
    const target = fixture.memoryFile.read().l2.find((row) => row.id === conflict.targetMemoryId)!;
    finish.resolve({ resolutionType: "preference_evolution", sourceMemoryId: source.id, targetMemoryId: target.id, status: "resolved", confidence: 0.93, reason: "newer preference", actions: ["supersede_target"] });
    await shutdown;
    expect(drained).toBe(true);
  });

  it("restores a superseded memory through IPC and schedules an executable conflict inspection", async () => {
    const restored = memory(OLD_ID, "I use Python", "2026-07-15T00:00:00.000Z");
    restored.status = "superseded";
    restored.isEnabled = false;
    restored.supersededBy = "memory-current";
    const current = memory("memory-current", "I no longer use Python", "2026-07-16T00:00:00.000Z");
    let file: MemoryFile = {
      ...createEmptyMemoryFileV2(),
      l2: [restored, current],
      evidence: [
        { id: `evidence-${restored.id}`, memoryId: restored.id, quote: restored.content, capturedAt: restored.createdAt, source: "conversation", sourceMemoryIds: [] },
        { id: `evidence-${current.id}`, memoryId: current.id, quote: current.content, capturedAt: current.createdAt, source: "conversation", sourceMemoryIds: [] },
      ],
    };
    const store: MemoryStore = {
      load: async () => structuredClone(file),
      update: async (mutator) => {
        const draft = structuredClone(file);
        mutator(draft);
        file = draft;
        return structuredClone(file);
      },
    };
    const chatHandlers = new Map<string, IpcHandler>();
    const memoryHandlers = new Map<string, (event: MemoryIpcEventLike, payload?: unknown) => Promise<unknown>>();
    const memoryRecall = {
      recall: vi.fn(async () => ({
        l0: file.l0,
        l1: file.l1,
        l2: file.l2.map((row) => ({ memory: structuredClone(row), score: 0.95 })),
      })),
    };
    const runtime = await registerChatIpc({
      ipcMain: { handle: (channel, handler) => chatHandlers.set(channel, handler) },
      runAgent: vi.fn(),
      createConfig: () => config,
      createToolRegistry: () => ({ getEnabledToolSpecs: () => [] }),
      createPromptComposer: () => ({ composeSystemPrompt: () => "system" }),
      loadPersonaConfig: async () => ({ styleId: "default" }),
      savePersonaConfig: async () => undefined,
      adapter: { id: "fake", buildRequest: vi.fn(), parseResponse: vi.fn(), appendToolResults: vi.fn() },
      memoryStore: store,
      memoryRecall,
      memoryJudge: { judge: vi.fn(async () => []) },
      memoryWriteQueue: createMemoryWriteQueue(),
      memoryResolver: {
        resolve: async (input) => ({
          resolutionType: "uncertain",
          sourceMemoryId: input.source.id,
          targetMemoryId: input.target.id,
          status: "uncertain",
          confidence: 0.5,
          reason: "needs review",
          actions: ["mark_uncertain"],
        }),
      },
      memoryResolverQueue: createMemoryResolverQueue(),
    });
    const restoreSender = { send: vi.fn<(channel: string, payload: ChatAgentEventPayload) => void>() };
    const afterRestoreL2 = vi.fn((id: string, context?: { sender?: IpcSenderLike; runId?: string }) => (
      runtime.inspectRestoredMemory!(id, context?.sender, context?.runId)
    ));
    registerMemoryIpc({
      ipcMain: {
        handle: (channel, handler) => memoryHandlers.set(channel, handler),
        removeHandler: (channel) => memoryHandlers.delete(channel),
      },
      governance: createMemoryGovernanceService({ store }),
      afterRestoreL2,
    });

    await expect(memoryHandlers.get(IPC_CHANNELS.memory.restoreL2)!({ sender: restoreSender }, OLD_ID))
      .resolves.toMatchObject({ ok: true });
    await runtime.flushBackgroundTasks();

    expect(afterRestoreL2).toHaveBeenCalledWith(OLD_ID, {
      sender: restoreSender,
      runId: "memory_restore_1",
    });
    expect(memoryRecall.recall).toHaveBeenCalledWith(restored.content);

    expect(file.l2.find((row) => row.id === OLD_ID)).toMatchObject({
      status: "active",
      isEnabled: true,
      conflictWith: ["memory-current"],
    });
    expect(file.l2.find((row) => row.id === "memory-current")?.conflictWith).toEqual([OLD_ID]);
    expect(file.conflictLogs).toMatchObject([{ status: "uncertain" }]);
    const events = restoreSender.send.mock.calls.map(([, payload]) => payload.event);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "memory_governance_changed",
      "memory_conflict_detected",
      "memory_resolver_started",
      "memory_resolver_finished",
    ]));
    expect(JSON.stringify(events)).not.toContain(restored.content);
    expect(JSON.stringify(events)).not.toContain(current.content);
  });
});
