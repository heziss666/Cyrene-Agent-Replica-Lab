import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../src/main/agent/agent-events.js";
import { registerChatIpc } from "../../src/main/app/register-chat-ipc.js";
import { buildMemoryContext } from "../../src/main/memory/memory-context.js";
import type { MemoryStore } from "../../src/main/memory/memory-store.js";
import type {
  MemoryCandidate,
  MemoryFile,
  MemoryRecallResult,
} from "../../src/main/memory/memory-types.js";
import {
  createMemoryWriteQueue,
  type MemoryWriteQueue,
} from "../../src/main/memory/memory-write-queue.js";
import type { ChatMessage } from "../../src/shared/chat-types.js";
import type { ChatAgentEventPayload } from "../../src/shared/electron-api.js";
import { IPC_CHANNELS } from "../../src/shared/ipc-channels.js";

type IpcEvent = {
  sender: {
    send: (channel: string, payload: ChatAgentEventPayload) => void;
  };
};

type IpcHandler = (event: IpcEvent, payload?: unknown) => Promise<unknown>;

interface FakeIpcMain {
  handlers: Map<string, IpcHandler>;
  handle: (channel: string, handler: IpcHandler) => void;
}

const config = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  apiKey: "sk-test",
};

const validCandidate: MemoryCandidate = {
  layer: "L0",
  field: "preferredName",
  content: "Alex",
  confidence: 0.99,
  importance: "high",
  evidenceQuote: "Call me Alex",
  reason: "The user stated a preferred name.",
};

function emptyMemoryFile(): MemoryFile {
  return {
    schemaVersion: 1,
    l0: { longTermInterests: [], permanentNotes: [] },
    l1: { recentGoals: [], recentPreferences: [] },
    l2: [],
  };
}

function emptyRecall(): MemoryRecallResult {
  const memory = emptyMemoryFile();
  return { l0: memory.l0, l1: memory.l1, l2: [] };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createFakeIpcMain(): FakeIpcMain {
  const handlers = new Map<string, IpcHandler>();
  return {
    handlers,
    handle: (channel, handler) => handlers.set(channel, handler),
  };
}

function createSender() {
  return {
    sender: {
      send: vi.fn<(channel: string, payload: ChatAgentEventPayload) => void>(),
    },
  };
}

function sentEvents(sender: ReturnType<typeof createSender>["sender"]): AgentEvent[] {
  return sender.send.mock.calls.map(([, payload]) => payload.event);
}

function sentEventTypes(sender: ReturnType<typeof createSender>["sender"]): string[] {
  return sentEvents(sender).map((event) => event.type);
}

type RegisterDeps = Parameters<typeof registerChatIpc>[0];

function createFakeDeps(
  runAgent: ReturnType<typeof vi.fn>,
  overrides: Partial<RegisterDeps> = {},
): RegisterDeps & { ipcMain: FakeIpcMain } {
  const ipcMain = createFakeIpcMain();
  const memoryStore: MemoryStore = {
    load: vi.fn(async () => emptyMemoryFile()),
    update: vi.fn(async (mutator) => {
      const memory = emptyMemoryFile();
      mutator(memory);
      return memory;
    }),
  };
  const memoryWriteQueue: MemoryWriteQueue = {
    schedule: vi.fn(),
    pendingCount: () => 0,
    flush: async () => undefined,
  };
  return {
    ipcMain,
    runAgent,
    createConfig: () => config,
    createToolRegistry: () => ({ getEnabledToolSpecs: () => [] }),
    createPromptComposer: () => ({
      composeSystemPrompt: ({
        styleId,
        transition,
      }: {
        styleId: string;
        transition?: { from: string; to: string };
      }) => `system:${styleId}:${transition ? `${transition.from}->${transition.to}` : "steady"}`,
    }),
    loadPersonaConfig: async () => ({ styleId: "default" }),
    savePersonaConfig: vi.fn(async () => undefined),
    adapter: {
      id: "fake",
      buildRequest: vi.fn(),
      parseResponse: vi.fn(),
      appendToolResults: vi.fn(),
    },
    memoryStore,
    memoryRecall: { recall: vi.fn(async () => emptyRecall()) },
    memoryJudge: { judge: vi.fn(async () => []) },
    memoryManager: {
      writeCandidates: vi.fn(async ({ candidates }) => ({
        candidateCount: candidates.length,
        writtenCount: 0,
        skippedCount: candidates.length,
        writes: [],
      })),
    },
    memoryWriteQueue,
    buildMemoryContext,
    ...overrides,
  } as RegisterDeps & { ipcMain: FakeIpcMain };
}

function successfulAgent(reply = "reply") {
  return vi.fn(async ({
    messages,
    onEvent,
  }: {
    messages: ChatMessage[];
    onEvent?: (event: AgentEvent) => void;
    toolRegistry: unknown;
  }) => {
    onEvent?.({ type: "final_reply", round: 1, text: reply });
    return {
      reply,
      messages: [...messages, { role: "assistant" as const, content: reply }],
      toolResults: [],
    };
  });
}

describe("registerChatIpc", () => {
  it("injects recalled memory into the current system message", async () => {
    const memoryRecall = {
      recall: vi.fn(async (): Promise<MemoryRecallResult> => ({
        l0: {
          preferredName: "Alex",
          longTermInterests: [],
          permanentNotes: [],
        },
        l1: {
          currentProject: "Phase 7A",
          recentGoals: [],
          recentPreferences: [],
        },
        l2: [],
        retrievalMode: "vector",
      })),
    };
    const runAgent = successfulAgent("A memory system.");
    const deps = createFakeDeps(runAgent, { memoryRecall });
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;

    const result = await send({ sender }, "What are we building?") as {
      reply: string;
    };

    expect(result.reply).toBe("A memory system.");
    expect(memoryRecall.recall).toHaveBeenCalledWith("What are we building?");
    expect(runAgent.mock.calls[0]?.[0].messages[0].content).toContain("Alex");
    expect(runAgent.mock.calls[0]?.[0].messages[0].content).toContain("Phase 7A");
    expect(runAgent.mock.calls[0]?.[0].messages[0].content).toContain(
      "system:default:steady\n\n---\n\n",
    );
    expect(runAgent.mock.calls[0]?.[0].messages.slice(1)).not.toContainEqual(
      expect.objectContaining({ role: "system" }),
    );
  });

  it("returns the reply before a deferred MemoryJudge completes", async () => {
    const judgeDeferred = createDeferred<MemoryCandidate[]>();
    const memoryJudge = { judge: vi.fn(() => judgeDeferred.promise) };
    const memoryManager = {
      writeCandidates: vi.fn(async ({ candidates }: {
        userMessage: string;
        candidates: MemoryCandidate[];
      }) => ({
        candidateCount: candidates.length,
        writtenCount: 1,
        skippedCount: 0,
        writes: ["L0.preferredName"],
      })),
    };
    const memoryWriteQueue = createMemoryWriteQueue();
    const runAgent = successfulAgent("Hello, Alex.");
    const deps = createFakeDeps(runAgent, {
      memoryJudge,
      memoryManager,
      memoryWriteQueue,
    });
    const runtime = await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;

    const result = await send({ sender }, "Call me Alex") as { reply: string };

    expect(result.reply).toBe("Hello, Alex.");
    expect(memoryJudge.judge).toHaveBeenCalledWith({
      userMessage: "Call me Alex",
      assistantReply: "Hello, Alex.",
    });
    expect(memoryManager.writeCandidates).not.toHaveBeenCalled();
    expect(sentEventTypes(sender)).toContain("memory_write_scheduled");
    expect(runtime.pendingBackgroundTaskCount()).toBe(1);

    judgeDeferred.resolve([validCandidate]);
    await runtime.flushBackgroundTasks();

    expect(memoryManager.writeCandidates).toHaveBeenCalledWith({
      userMessage: "Call me Alex",
      candidates: [validCandidate],
    });
    expect(runtime.pendingBackgroundTaskCount()).toBe(0);
    expect(sentEventTypes(sender).filter((type) => type.startsWith("memory_"))).toEqual([
      "memory_recall_started",
      "memory_recall_finished",
      "memory_write_scheduled",
      "memory_judge_started",
      "memory_judge_finished",
      "memory_write_finished",
    ]);
  });

  it("does not schedule a memory write when the main model fails", async () => {
    const schedule = vi.fn<MemoryWriteQueue["schedule"]>();
    const memoryWriteQueue: MemoryWriteQueue = {
      schedule,
      pendingCount: () => 0,
      flush: async () => undefined,
    };
    const runAgent = vi.fn(async () => {
      throw new Error("model failed");
    });
    const deps = createFakeDeps(runAgent, { memoryWriteQueue });
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;

    await expect(send({ sender }, "do not remember this")).rejects.toThrow("model failed");

    expect(schedule).not.toHaveBeenCalled();
    expect(sentEventTypes(sender)).not.toContain("memory_write_scheduled");
  });

  it("continues without memory when recall fails", async () => {
    const memoryRecall = {
      recall: vi.fn(async () => {
        throw new Error("index unavailable");
      }),
    };
    const runAgent = successfulAgent("Still here.");
    const deps = createFakeDeps(runAgent, { memoryRecall });
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;

    const result = await send({ sender }, "Can you answer?") as { reply: string };

    expect(result.reply).toBe("Still here.");
    expect(runAgent.mock.calls[0]?.[0].messages[0]).toEqual({
      role: "system",
      content: "system:default:steady",
    });
    const recallFailures = sentEvents(sender).filter(
      (event) => event.type === "memory_write_failed" && event.stage === "recall",
    );
    expect(recallFailures).toEqual([{
      type: "memory_write_failed",
      stage: "recall",
      message: "Memory recall unavailable",
    }]);
    expect(JSON.stringify(recallFailures)).not.toContain("index unavailable");
  });

  it("clears only session history and recalls memory again for the next chat", async () => {
    const memoryRecall = { recall: vi.fn(async () => emptyRecall()) };
    const runAgent = successfulAgent();
    const deps = createFakeDeps(runAgent, { memoryRecall });
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;
    const clear = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.clearSession)!;

    await send({ sender }, "first chat");
    await expect(clear({ sender })).resolves.toEqual({ cleared: true, messageCount: 0 });
    await send({ sender }, "new chat");

    expect(memoryRecall.recall.mock.calls).toEqual([["first chat"], ["new chat"]]);
    expect(runAgent.mock.calls[1]?.[0].messages).toEqual([
      { role: "system", content: "system:default:steady" },
      { role: "user", content: "new chat" },
    ]);
  });

  it("isolates a judge failure and continues later queued memory work", async () => {
    const memoryJudge = {
      judge: vi.fn()
        .mockRejectedValueOnce(new Error("judge leaked secret"))
        .mockResolvedValueOnce([validCandidate]),
    };
    const memoryManager = {
      writeCandidates: vi.fn(async ({ candidates }: {
        userMessage: string;
        candidates: MemoryCandidate[];
      }) => ({
        candidateCount: candidates.length,
        writtenCount: candidates.length,
        skippedCount: 0,
        writes: ["L0.preferredName"],
      })),
    };
    const memoryWriteQueue = createMemoryWriteQueue();
    const deps = createFakeDeps(successfulAgent(), {
      memoryJudge,
      memoryManager,
      memoryWriteQueue,
    });
    const runtime = await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;

    await send({ sender }, "first turn");
    await send({ sender }, "Call me Alex");
    await runtime.flushBackgroundTasks();

    expect(memoryJudge.judge).toHaveBeenCalledTimes(2);
    expect(memoryManager.writeCandidates).toHaveBeenCalledOnce();
    expect(memoryManager.writeCandidates).toHaveBeenCalledWith({
      userMessage: "Call me Alex",
      candidates: [validCandidate],
    });
    const judgeFailures = sentEvents(sender).filter(
      (event) => event.type === "memory_write_failed" && event.stage === "judge",
    );
    expect(judgeFailures).toEqual([{
      type: "memory_write_failed",
      stage: "judge",
      message: "Memory judge unavailable",
    }]);
    expect(JSON.stringify(judgeFailures)).not.toContain("judge leaked secret");
  });

  it("isolates a write failure, sanitizes summaries, and continues later queued work", async () => {
    const memoryJudge = { judge: vi.fn(async () => [validCandidate]) };
    const memoryManager = {
      writeCandidates: vi.fn()
        .mockRejectedValueOnce(new Error("write leaked secret"))
        .mockResolvedValueOnce({
          candidateCount: 1,
          writtenCount: 2,
          skippedCount: 0,
          writes: ["L1.currentProject", "unsafe-manager-string"],
        }),
    };
    const memoryWriteQueue = createMemoryWriteQueue();
    const deps = createFakeDeps(successfulAgent(), {
      memoryJudge,
      memoryManager,
      memoryWriteQueue,
    });
    const runtime = await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;

    await send({ sender }, "first turn");
    await send({ sender }, "second turn");
    await runtime.flushBackgroundTasks();

    expect(memoryManager.writeCandidates).toHaveBeenCalledTimes(2);
    const writeFailures = sentEvents(sender).filter(
      (event) => event.type === "memory_write_failed" && event.stage === "write",
    );
    expect(writeFailures).toEqual([{
      type: "memory_write_failed",
      stage: "write",
      message: "Memory write unavailable",
    }]);
    const writeFinished = sentEvents(sender).filter(
      (event) => event.type === "memory_write_finished",
    );
    expect(writeFinished).toEqual([{
      type: "memory_write_finished",
      writtenCount: 2,
      skippedCount: 0,
      writes: ["L1.currentProject"],
    }]);
    expect(JSON.stringify([...writeFailures, ...writeFinished])).not.toContain(
      "leaked secret",
    );
    expect(JSON.stringify(writeFinished)).not.toContain("unsafe-manager-string");
  });

  it("reports an unexpected queue error through one safe write failure event", async () => {
    let queueErrorHandler: ((error: unknown) => void) | undefined;
    const memoryWriteQueue: MemoryWriteQueue = {
      schedule: vi.fn((_task, onError) => {
        queueErrorHandler = onError;
      }),
      pendingCount: () => 1,
      flush: async () => undefined,
    };
    const deps = createFakeDeps(successfulAgent(), { memoryWriteQueue });
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;

    await send({ sender }, "hello");
    queueErrorHandler?.(new Error("unexpected queue secret"));

    const writeFailures = sentEvents(sender).filter(
      (event) => event.type === "memory_write_failed" && event.stage === "write",
    );
    expect(writeFailures).toEqual([{
      type: "memory_write_failed",
      stage: "write",
      message: "Memory write unavailable",
    }]);
    expect(JSON.stringify(writeFailures)).not.toContain("unexpected queue secret");
  });

  it("keeps chat and background memory work alive when the sender throws", async () => {
    const memoryJudge = { judge: vi.fn(async () => [validCandidate]) };
    const memoryManager = {
      writeCandidates: vi.fn(async () => ({
        candidateCount: 1,
        writtenCount: 1,
        skippedCount: 0,
        writes: ["L0.preferredName"],
      })),
    };
    const memoryWriteQueue = createMemoryWriteQueue();
    const deps = createFakeDeps(successfulAgent(), {
      memoryJudge,
      memoryManager,
      memoryWriteQueue,
    });
    const runtime = await registerChatIpc(deps);
    const sender = {
      send: vi.fn(() => {
        throw new Error("sender destroyed");
      }),
    };
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;

    await expect(send({ sender }, "Call me Alex")).resolves.toMatchObject({
      reply: "reply",
    });
    await expect(runtime.flushBackgroundTasks()).resolves.toBeUndefined();

    expect(memoryJudge.judge).toHaveBeenCalledOnce();
    expect(memoryManager.writeCandidates).toHaveBeenCalledWith({
      userMessage: "Call me Alex",
      candidates: [validCandidate],
    });
    expect(runtime.pendingBackgroundTaskCount()).toBe(0);
  });

  it("serializes overlapping sends and preserves committed history and one transition", async () => {
    const firstAgentStarted = createDeferred<void>();
    const finishFirstAgent = createDeferred<void>();
    const memoryRecall = { recall: vi.fn(async () => emptyRecall()) };
    const runAgent = vi.fn()
      .mockImplementationOnce(async ({ messages }: { messages: ChatMessage[] }) => {
        firstAgentStarted.resolve();
        await finishFirstAgent.promise;
        return {
          reply: "first reply",
          messages: [
            ...messages,
            { role: "assistant" as const, content: "first reply" },
          ],
          toolResults: [],
        };
      })
      .mockImplementationOnce(async ({ messages }: { messages: ChatMessage[] }) => ({
        reply: "second reply",
        messages: [
          ...messages,
          { role: "assistant" as const, content: "second reply" },
        ],
        toolResults: [],
      }));
    const deps = createFakeDeps(runAgent, { memoryRecall });
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;
    const setStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.setStyle)!;
    await setStyle({ sender }, "healing");

    const firstRequest = send({ sender }, "first turn");
    await firstAgentStarted.promise;
    const secondRequest = send({ sender }, "second turn");
    await Promise.resolve();
    await Promise.resolve();
    const recallCountBeforeFirstCompletion = memoryRecall.recall.mock.calls.length;
    const agentCountBeforeFirstCompletion = runAgent.mock.calls.length;

    finishFirstAgent.resolve();
    const [firstResult, secondResult] = await Promise.all([
      firstRequest,
      secondRequest,
    ]);

    expect(recallCountBeforeFirstCompletion).toBe(1);
    expect(agentCountBeforeFirstCompletion).toBe(1);
    expect(memoryRecall.recall.mock.calls).toEqual([["first turn"], ["second turn"]]);
    expect(runAgent.mock.calls[0]?.[0].messages[0]).toEqual({
      role: "system",
      content: "system:healing:default->healing",
    });
    expect(runAgent.mock.calls[1]?.[0].messages).toEqual([
      { role: "system", content: "system:healing:steady" },
      { role: "user", content: "first turn" },
      { role: "assistant", content: "first reply" },
      { role: "user", content: "second turn" },
    ]);
    expect(firstResult).toMatchObject({ reply: "first reply", runId: "run_1" });
    expect(secondResult).toMatchObject({ reply: "second reply", runId: "run_2" });
  });

  it("runs clear after an in-flight send and prevents stale history restoration", async () => {
    const firstAgentStarted = createDeferred<void>();
    const finishFirstAgent = createDeferred<void>();
    const runAgent = vi.fn()
      .mockImplementationOnce(async ({ messages }: { messages: ChatMessage[] }) => {
        firstAgentStarted.resolve();
        await finishFirstAgent.promise;
        return {
          reply: "old reply",
          messages: [
            ...messages,
            { role: "assistant" as const, content: "old reply" },
          ],
          toolResults: [],
        };
      })
      .mockImplementationOnce(async ({ messages }: { messages: ChatMessage[] }) => ({
        reply: "new reply",
        messages: [
          ...messages,
          { role: "assistant" as const, content: "new reply" },
        ],
        toolResults: [],
      }));
    const deps = createFakeDeps(runAgent);
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;
    const clear = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.clearSession)!;

    const oldRequest = send({ sender }, "old turn");
    await firstAgentStarted.promise;
    let clearSettled = false;
    const clearRequest = clear({ sender }).then((result) => {
      clearSettled = true;
      return result;
    });
    await Promise.resolve();
    const clearSettledBeforeOldCompletion = clearSettled;

    finishFirstAgent.resolve();
    await oldRequest;
    const clearResult = await clearRequest;
    await send({ sender }, "new turn");

    expect(clearSettledBeforeOldCompletion).toBe(false);
    expect(clearResult).toEqual({ cleared: true, messageCount: 0 });
    expect(runAgent.mock.calls[1]?.[0].messages).toEqual([
      { role: "system", content: "system:default:steady" },
      { role: "user", content: "new turn" },
    ]);
  });

  it("releases session serialization before a deferred MemoryJudge completes", async () => {
    const judgeDeferred = createDeferred<MemoryCandidate[]>();
    const memoryRecall = { recall: vi.fn(async () => emptyRecall()) };
    const memoryJudge = {
      judge: vi.fn()
        .mockImplementationOnce(() => judgeDeferred.promise)
        .mockResolvedValueOnce([]),
    };
    const memoryWriteQueue = createMemoryWriteQueue();
    const runAgent = successfulAgent();
    const deps = createFakeDeps(runAgent, {
      memoryRecall,
      memoryJudge,
      memoryWriteQueue,
    });
    const runtime = await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;

    await send({ sender }, "first turn");
    const secondResult = await send({ sender }, "second turn");

    expect(secondResult).toMatchObject({ reply: "reply", runId: "run_2" });
    expect(memoryRecall.recall).toHaveBeenCalledTimes(2);
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(memoryJudge.judge).toHaveBeenCalledOnce();

    judgeDeferred.resolve([]);
    await runtime.flushBackgroundTasks();
    expect(memoryJudge.judge).toHaveBeenCalledTimes(2);
  });

  it("keeps the request style stable while deferred recall is running", async () => {
    const recallDeferred = createDeferred<MemoryRecallResult>();
    const memoryRecall = { recall: vi.fn(() => recallDeferred.promise) };
    const runAgent = successfulAgent();
    const deps = createFakeDeps(runAgent, { memoryRecall });
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;
    const setStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.setStyle)!;

    const olderRequest = send({ sender }, "started before the style change");
    await Promise.resolve();
    let styleSettled = false;
    const styleChange = setStyle({ sender }, "healing").then((result) => {
      styleSettled = true;
      return result;
    });
    await Promise.resolve();
    await Promise.resolve();
    const styleSettledBeforeRecall = styleSettled;
    recallDeferred.resolve(emptyRecall());
    await olderRequest;
    await styleChange;
    await send({ sender }, "use the new style");

    expect(styleSettledBeforeRecall).toBe(false);
    expect(runAgent.mock.calls[0]?.[0].messages[0]).toEqual({
      role: "system",
      content: "system:default:steady",
    });
    expect(runAgent.mock.calls[1]?.[0].messages[0]).toEqual({
      role: "system",
      content: "system:healing:default->healing",
    });
  });

  it("uses one fresh dynamic system message while preserving non-system history", async () => {
    const runAgent = successfulAgent();
    const deps = createFakeDeps(runAgent);
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;

    const first = await send({ sender }, "first");
    const second = await send({ sender }, "second");

    expect(runAgent.mock.calls[0]?.[0].messages).toEqual([
      { role: "system", content: "system:default:steady" },
      { role: "user", content: "first" },
    ]);
    expect(runAgent.mock.calls[1]?.[0].messages).toEqual([
      { role: "system", content: "system:default:steady" },
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "second" },
    ]);
    expect(first).toEqual({
      reply: "reply",
      runId: "run_1",
      messageCount: 2,
      toolResultCount: 0,
    });
    expect(second).toMatchObject({ runId: "run_2", messageCount: 4 });
    expect(sender.send).toHaveBeenCalledWith(
      IPC_CHANNELS.chat.agentEvent,
      expect.objectContaining({ runId: "run_1" }),
    );
  });

  it("switches style without clearing history and uses the transition once", async () => {
    const runAgent = successfulAgent();
    const savePersonaConfig = vi.fn(async () => undefined);
    const deps = createFakeDeps(runAgent, { savePersonaConfig });
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;
    const setStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.setStyle)!;

    await send({ sender }, "remember this");
    await expect(setStyle({ sender }, "healing")).resolves.toEqual({ styleId: "healing" });
    await send({ sender }, "continue");
    await send({ sender }, "again");

    expect(savePersonaConfig).toHaveBeenCalledWith({ styleId: "healing" });
    expect(runAgent.mock.calls[1]?.[0].messages[0]).toEqual({
      role: "system",
      content: "system:healing:default->healing",
    });
    expect(runAgent.mock.calls[1]?.[0].messages).toContainEqual({
      role: "user",
      content: "remember this",
    });
    expect(runAgent.mock.calls[2]?.[0].messages[0]).toEqual({
      role: "system",
      content: "system:healing:steady",
    });
  });

  it("retains a pending transition when the model request fails", async () => {
    const runAgent = successfulAgent()
      .mockRejectedValueOnce(new Error("model unavailable"));
    const deps = createFakeDeps(runAgent);
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;
    const setStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.setStyle)!;
    await setStyle({ sender }, "sweet");

    await expect(send({ sender }, "failed turn")).rejects.toThrow("model unavailable");
    await send({ sender }, "retry");

    expect(runAgent.mock.calls[1]?.[0].messages[0]).toEqual({
      role: "system",
      content: "system:sweet:default->sweet",
    });
  });

  it("does not let an older request clear a transition created while it runs", async () => {
    let finishFirstRun!: () => void;
    const firstRunFinished = new Promise<void>((resolve) => {
      finishFirstRun = resolve;
    });
    const runAgent = vi.fn()
      .mockImplementationOnce(async ({ messages }: { messages: ChatMessage[] }) => {
        await firstRunFinished;
        return {
          reply: "old reply",
          messages: [...messages, { role: "assistant" as const, content: "old reply" }],
          toolResults: [],
        };
      })
      .mockImplementation(successfulAgent());
    const deps = createFakeDeps(runAgent);
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;
    const setStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.setStyle)!;

    const olderRequest = send({ sender }, "started before the style change");
    const styleChange = setStyle({ sender }, "healing");
    finishFirstRun();
    await olderRequest;
    await styleChange;
    await send({ sender }, "use the new style");

    expect(runAgent.mock.calls[0]?.[0].messages[0]).toEqual({
      role: "system",
      content: "system:default:steady",
    });
    expect(runAgent.mock.calls[1]?.[0].messages[0]).toEqual({
      role: "system",
      content: "system:healing:default->healing",
    });
  });

  it("rejects unknown styles without saving or changing state", async () => {
    const savePersonaConfig = vi.fn(async () => undefined);
    const deps = createFakeDeps(successfulAgent(), { savePersonaConfig });
    await registerChatIpc(deps);
    const { sender } = createSender();
    const setStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.setStyle)!;
    const getStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.getStyle)!;

    await expect(setStyle({ sender }, "phone")).rejects.toThrow("Invalid persona style: phone");
    await expect(getStyle({ sender })).resolves.toEqual({ styleId: "default" });
    expect(savePersonaConfig).not.toHaveBeenCalled();
  });

  it("keeps in-memory style unchanged when persistence fails", async () => {
    const deps = createFakeDeps(successfulAgent(), {
      savePersonaConfig: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });
    await registerChatIpc(deps);
    const { sender } = createSender();
    const setStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.setStyle)!;
    const getStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.getStyle)!;

    await expect(setStyle({ sender }, "focused")).rejects.toThrow("disk full");
    await expect(getStyle({ sender })).resolves.toEqual({ styleId: "default" });
  });

  it("clears messages while keeping the selected style", async () => {
    const deps = createFakeDeps(successfulAgent());
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;
    const clear = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.clearSession)!;
    const setStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.setStyle)!;
    const getStyle = deps.ipcMain.handlers.get(IPC_CHANNELS.persona.getStyle)!;

    await send({ sender }, "hello");
    await setStyle({ sender }, "lively");

    await expect(clear({ sender })).resolves.toEqual({ cleared: true, messageCount: 0 });
    await expect(getStyle({ sender })).resolves.toEqual({ styleId: "lively" });
  });

  it("creates the tool registry only once", async () => {
    const registry = { getEnabledToolSpecs: () => [] };
    const createToolRegistry = vi.fn(() => registry);
    const runAgent = successfulAgent();
    const deps = createFakeDeps(runAgent, { createToolRegistry });
    await registerChatIpc(deps);
    const { sender } = createSender();
    const send = deps.ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;

    await send({ sender }, "first");
    await send({ sender }, "second");

    expect(createToolRegistry).toHaveBeenCalledOnce();
    expect(runAgent.mock.calls[0]?.[0].toolRegistry).toBe(registry);
    expect(runAgent.mock.calls[1]?.[0].toolRegistry).toBe(registry);
  });
});
