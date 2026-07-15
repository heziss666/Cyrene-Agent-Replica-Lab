import { describe, expect, it, vi } from "vitest";
import {
  createMemoryGovernanceChangedEvent,
  createMemoryMaintenanceFailedEvent,
  createMemoryMaintenanceFinishedEvent,
  createMemoryMaintenanceStartedEvent,
} from "../../src/main/agent/agent-events.js";
import { formatRendererEvent } from "../../src/renderer/chat/renderer-events.js";
import type { CyreneApi } from "../../src/shared/electron-api.js";
import { IPC_CHANNELS } from "../../src/shared/ipc-channels.js";
import { mountMemoryView } from "../../src/renderer/chat/memory-view.js";
import type { MemorySnapshot } from "../../src/shared/memory-api-types.js";
import { MemoryScheduler } from "../../src/main/memory/memory-scheduler.js";
import { createEmptyMemoryFileV2, type MemoryFile } from "../../src/main/memory/memory-types.js";

describe("memory lifecycle maintenance integration", () => {
  it("starts automatic maintenance on the tenth successful post-reply write", async () => {
    let memory = createEmptyMemoryFileV2();
    memory.maintenance.lastMaintenanceAt = "2026-07-15T00:00:00.000Z";
    const runNow = vi.fn(async () => undefined);
    const scheduler = new MemoryScheduler({
      store: {
        load: async () => structuredClone(memory),
        update: async (mutator) => {
          const draft = structuredClone(memory);
          mutator(draft);
          memory = draft;
          return structuredClone(memory);
        },
      },
      coordinator: { initialize: async () => undefined, runNow },
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      idFactory: () => "automatic-run-10",
    });

    for (let write = 1; write < 10; write += 1) {
      await expect(scheduler.recordSuccessfulWrite()).resolves.toBeUndefined();
    }
    expect(runNow).not.toHaveBeenCalled();
    await expect(scheduler.recordSuccessfulWrite()).resolves.toBe("automatic-run-10");
    await scheduler.flush();

    expect(runNow).toHaveBeenCalledOnce();
    expect(runNow).toHaveBeenCalledWith("write_count");
    expect((memory as MemoryFile).maintenance.successfulWritesSinceMaintenance).toBe(10);
    await scheduler.beginShutdown();
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
      createMemoryGovernanceChangedEvent({ changedCount: 8 }),
    ];

    expect(events.map(formatRendererEvent)).toEqual([
      "Memory maintenance started: 1 pending",
      "Memory maintenance finished: 2 aging, 1 archived, 4 weights, 1 L1 expired",
      "Memory maintenance failed: 1 step",
      "Memory governance changed: 8 updates",
    ]);
    expect(JSON.stringify(events)).not.toMatch(/content|evidence|reason|memoryId/i);
  });

  it("exposes the manual maintenance preload contract", () => {
    expect(IPC_CHANNELS.memory.runMaintenance).toBe("cyrene:memory:run-maintenance");
    type RunMaintenance = NonNullable<CyreneApi["memory"]["runMaintenance"]>;
    expectTypeOf<RunMaintenance>().toBeFunction();
  });

  it("renders Overview lifecycle counts and a tooltip-labelled icon action", async () => {
    const document = createDocument();
    const root = document.createElement("section");
    const snapshot = createSnapshot();
    const runMaintenance = vi.fn(async () => ({ runId: "maintenance-run-9" }));
    const api = {
      getSnapshot: vi.fn(async () => snapshot),
      runMaintenance,
    } as unknown as CyreneApi["memory"];
    const view = mountMemoryView({ root, api, document });

    await view.show();
    const action = root.querySelector('[data-action="run-maintenance"]') as HTMLButtonElement;
    expect(root.textContent).toContain("Active2Aging1Archived1");
    expect(root.textContent).toContain("8 successful writes until next maintenance");
    expect(action.textContent).toBe("↻");
    expect(action.title).toBe("Run memory maintenance");
    expect(action.getAttribute("aria-label")).toBe("Run memory maintenance");

    action.click();
    await vi.waitFor(() => expect(runMaintenance).toHaveBeenCalledOnce());
  });
});

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
