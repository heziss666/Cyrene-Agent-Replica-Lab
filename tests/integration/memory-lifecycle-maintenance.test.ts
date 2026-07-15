import { describe, expect, it, vi } from "vitest";
import {
  countMemoryGovernanceChanges,
  createMemoryGovernanceChangedEvent,
  createMemoryMaintenanceFailedEvent,
  createMemoryMaintenanceFinishedEvent,
  createMemoryMaintenanceStartedEvent,
} from "../../src/main/agent/agent-events.js";
import { formatRendererEvent } from "../../src/renderer/chat/renderer-events.js";
import type { ChatAgentEventPayload, CyreneApi } from "../../src/shared/electron-api.js";
import { IPC_CHANNELS } from "../../src/shared/ipc-channels.js";
import { mountMemoryView } from "../../src/renderer/chat/memory-view.js";
import type { MemorySnapshot } from "../../src/shared/memory-api-types.js";
import { MemoryScheduler } from "../../src/main/memory/memory-scheduler.js";
import { createEmptyMemoryFileV2, type MemoryFile } from "../../src/main/memory/memory-types.js";
import { registerChatIpc } from "../../src/main/app/register-chat-ipc.js";
import {
  registerMemoryIpc,
  type MemoryIpcEventLike,
  type MemoryIpcMainLike,
} from "../../src/main/app/register-memory-ipc.js";
import { createMemoryWriteQueue } from "../../src/main/memory/memory-write-queue.js";
import type { MemoryStore } from "../../src/main/memory/memory-store.js";
import type { ChatMessage } from "../../src/shared/chat-types.js";

describe("memory lifecycle maintenance integration", () => {
  it("starts automatic maintenance through chat IPC on the tenth successful post-reply write", async () => {
    let memory = createEmptyMemoryFileV2();
    memory.maintenance.lastMaintenanceAt = "2026-07-15T00:00:00.000Z";
    const maintenance = deferred<void>();
    const runNow = vi.fn(() => maintenance.promise);
    const store = createStore(() => memory, (next) => { memory = next; });
    const scheduler = new MemoryScheduler({
      store,
      coordinator: { initialize: async () => undefined, runNow },
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      idFactory: () => "automatic-run-10",
    });
    const ipcMain = createChatIpcMain();
    const runtime = await registerChatIpc({
      ipcMain,
      memoryStore: store,
      memoryScheduler: scheduler,
      memoryRecall: {
        recall: async () => {
          const snapshot = createEmptyMemoryFileV2();
          return { l0: snapshot.l0, l1: snapshot.l1, l2: [] };
        },
      },
      memoryJudge: { judge: async () => [{ candidate: true }] } as never,
      memoryManager: {
        writeCandidates: async () => ({
          candidateCount: 1,
          writtenCount: 1,
          skippedCount: 0,
          writes: ["L2"],
        }),
      },
      memoryWriteQueue: createMemoryWriteQueue(),
      runAgent: async ({ messages }: { messages: ChatMessage[] }) => ({
        reply: "stored",
        messages: [...messages, { role: "assistant", content: "stored" }],
        toolResults: [],
      }) as never,
      createConfig: () => ({
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "test",
      }),
      createToolRegistry: () => ({ getEnabledToolSpecs: () => [] }),
      createPromptComposer: () => ({ composeSystemPrompt: () => "system" }),
      loadPersonaConfig: async () => ({ styleId: "default" }),
      savePersonaConfig: async () => undefined,
      adapter: { id: "fake" } as never,
    });
    const send = ipcMain.handlers.get(IPC_CHANNELS.chat.sendMessage)!;

    for (let write = 1; write <= 10; write += 1) {
      await expect(send({ sender: { send: vi.fn() } }, `message-${write}`))
        .resolves.toMatchObject({ reply: "stored" });
      await runtime.flushBackgroundTasks();
      if (write < 10) expect(runNow).not.toHaveBeenCalled();
    }

    expect(runNow).toHaveBeenCalledOnce();
    expect(runNow).toHaveBeenCalledWith("write_count", "automatic-run-10");
    expect((memory as MemoryFile).maintenance.successfulWritesSinceMaintenance).toBe(10);
    maintenance.resolve();
    await scheduler.beginShutdown();
  });

  it("coalesces real manual IPC requests onto the scheduler run and event ID", async () => {
    let memory = createEmptyMemoryFileV2();
    memory.maintenance.lastMaintenanceAt = "2026-07-15T00:00:00.000Z";
    const maintenance = deferred<void>();
    const runNow = vi.fn(() => maintenance.promise);
    const scheduler = new MemoryScheduler({
      store: createStore(() => memory, (next) => { memory = next; }),
      coordinator: { initialize: async () => undefined, runNow },
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      idFactory: () => "shared-run-id",
    });
    const ipcMain = createMemoryIpcMain();
    const runtime = registerMemoryIpc({
      ipcMain,
      governance: {} as never,
      memoryScheduler: scheduler,
    });
    const runMaintenance = ipcMain.handlers.get(IPC_CHANNELS.memory.runMaintenance)!;

    await expect(Promise.all([runMaintenance({}), runMaintenance({})])).resolves.toEqual([
      { runId: "shared-run-id" },
      { runId: "shared-run-id" },
    ]);
    expect(runNow).toHaveBeenCalledWith("manual", "shared-run-id");

    maintenance.resolve();
    await runtime.beginShutdown();
  });

  it("publishes counts-only lifecycle and governance events", () => {
    const events = [
      createMemoryMaintenanceStartedEvent({ pendingCount: 1 }),
      createMemoryMaintenanceFinishedEvent({
        activeToAging: 2,
        agingToArchived: 1,
        weightUpdated: 4,
        l1Expired: 1,
      }),
      createMemoryMaintenanceFailedEvent({ failedStepCount: 1 }),
      createMemoryGovernanceChangedEvent({ changedCount: 5 }),
    ];

    expect(events.map(formatRendererEvent)).toEqual([
      "Memory maintenance started: 1 pending",
      "Memory maintenance finished: 2 aging, 1 archived, 4 weights, 1 L1 expired",
      "Memory maintenance failed: 1 step",
      "Memory governance changed: 5 updates",
    ]);
    expect(JSON.stringify(events)).not.toMatch(/content|evidence|reason|memoryId/i);
    expect(countMemoryGovernanceChanges({
      activeToAging: 2,
      agingToArchived: 1,
      weightUpdated: 4,
      l1Expired: 1,
    })).toBe(5);
    expect(countMemoryGovernanceChanges({
      activeToAging: 1,
      agingToArchived: 0,
      weightUpdated: 0,
      l1Expired: 0,
    })).toBe(1);
  });

  it("exposes the manual maintenance preload contract", () => {
    expect(IPC_CHANNELS.memory.runMaintenance).toBe("cyrene:memory:run-maintenance");
    expectTypeOf<CyreneApi["memory"]["runMaintenance"]>()
      .toEqualTypeOf<() => Promise<{ runId: string }>>();
  });

  it("renders Overview lifecycle counts and a tooltip-labelled icon action", async () => {
    const document = createDocument();
    const root = document.createElement("section");
    const snapshot = createSnapshot();
    const runMaintenance = vi.fn(async () => ({ runId: "maintenance-run-9" }));
    let onAgentEvent: ((payload: ChatAgentEventPayload) => void) | undefined;
    const api = {
      getSnapshot: vi.fn(async () => snapshot),
      runMaintenance,
    } as unknown as CyreneApi["memory"];
    const view = mountMemoryView({
      root,
      api,
      document,
      onAgentEvent: (listener) => { onAgentEvent = listener; },
    });

    await view.show();
    const action = root.querySelector('[data-action="run-maintenance"]') as HTMLButtonElement;
    expect(root.textContent).toContain("Active2Aging1Archived1");
    expect(root.textContent).toContain("8 successful writes until next maintenance");
    expect(action.textContent).toBe("↻");
    expect(action.title).toBe("Run memory maintenance");
    expect(action.getAttribute("aria-label")).toBe("Run memory maintenance");

    action.click();
    await vi.waitFor(() => expect(runMaintenance).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(root.textContent).toContain("maintenance-run-9"));
    (root.querySelector('[data-action="run-maintenance"]') as HTMLButtonElement)?.click();
    await vi.waitFor(() => expect(runMaintenance).toHaveBeenCalledTimes(2));
    onAgentEvent?.({
      runId: "maintenance-run-9",
      event: createMemoryMaintenanceStartedEvent({ pendingCount: 1 }),
    });
    await vi.waitFor(() => expect(root.textContent).toContain("maintenance-run-9: running"));
    onAgentEvent?.({
      runId: "maintenance-run-9",
      event: createMemoryMaintenanceFinishedEvent({
        activeToAging: 0,
        agingToArchived: 0,
        weightUpdated: 0,
        l1Expired: 0,
      }),
    });
    await vi.waitFor(() => expect(root.textContent).toContain("maintenance-run-9: finished"));
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function createStore(read: () => MemoryFile, write: (memory: MemoryFile) => void): MemoryStore {
  return {
    load: async () => structuredClone(read()),
    update: async (mutator) => {
      const draft = structuredClone(read());
      mutator(draft);
      write(draft);
      return structuredClone(draft);
    },
  };
}

function createChatIpcMain() {
  const handlers = new Map<string, (event: { sender: { send: ReturnType<typeof vi.fn> } }, payload?: unknown) => Promise<unknown>>();
  return { handlers, handle: (channel: string, handler: (typeof handlers extends Map<string, infer H> ? H : never)) => handlers.set(channel, handler) };
}

function createMemoryIpcMain(): MemoryIpcMainLike & {
  handlers: Map<string, (event: MemoryIpcEventLike, payload?: unknown) => Promise<unknown>>;
} {
  const handlers = new Map<string, (event: MemoryIpcEventLike, payload?: unknown) => Promise<unknown>>();
  return {
    handlers,
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => { handlers.delete(channel); },
  };
}

function createSnapshot(): MemorySnapshot {
  const l2 = (id: string, status: "active" | "aging" | "archived") => ({
    id,
    content: id,
    confidence: 1,
    importance: "medium" as const,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    lastAccessedAt: "2026-07-01T00:00:00.000Z",
    accessCount: 0,
    weight: 0.5,
    isPinned: false,
    isEnabled: true,
    status,
    syncStatus: "synced" as const,
    isSummary: false,
    evidenceCount: 0,
    sourceMemoryIds: [],
    conflictWith: [],
  });
  return {
    l0: { longTermInterests: [], permanentNotes: [] },
    l1: { recentGoals: [], recentPreferences: [] },
    l2: [l2("a", "active"), l2("b", "active"), l2("c", "aging"), l2("d", "archived")],
    conflicts: [],
    reflections: [],
    audit: [],
    maintenance: {
      lastMaintenanceAt: "2026-07-14T00:00:00.000Z",
      successfulWritesSinceMaintenance: 2,
      running: false,
    },
  };
}

function createDocument(): Document {
  class Element {
    tagName: string;
    className = "";
    title = "";
    type = "";
    value = "";
    disabled = false;
    children: Element[] = [];
    attributes = new Map<string, string>();
    listeners = new Map<string, Array<() => void>>();
    private ownText = "";

    constructor(tagName: string) { this.tagName = tagName.toUpperCase(); }
    get textContent(): string { return this.children.length ? this.children.map((child) => child.textContent).join("") : this.ownText; }
    set textContent(value: string) { this.ownText = value; }
    append(...children: Element[]): void { this.children.push(...children); }
    replaceChildren(...children: Element[]): void { this.children = children; this.ownText = ""; }
    setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
    getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
    addEventListener(name: string, listener: () => void): void {
      const listeners = this.listeners.get(name) ?? [];
      listeners.push(listener);
      this.listeners.set(name, listeners);
    }
    click(): void { for (const listener of this.listeners.get("click") ?? []) listener(); }
    querySelector(selector: string): Element | null {
      const match = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
      for (const child of this.children) {
        if (match && child.getAttribute(match[1]) === match[2]) return child;
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
      return null;
    }
  }
  return { createElement: (tag: string) => new Element(tag) } as unknown as Document;
}
