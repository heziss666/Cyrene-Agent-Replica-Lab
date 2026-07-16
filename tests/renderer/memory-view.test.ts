import { describe, expect, it, vi } from "vitest";
import type { MemoryApi, MemorySnapshot } from "../../src/shared/memory-api-types.js";
import {
  createMemoryGovernanceChangedEvent,
  createMemoryResolverFinishedEvent,
} from "../../src/main/agent/agent-events.js";
import { mountMemoryView } from "../../src/renderer/chat/memory-view.js";

type FakeElement = {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  value: string;
  disabled: boolean;
  hidden: boolean;
  children: FakeElement[];
  parentElement: FakeElement | null;
  attributes: Record<string, string>;
  listeners: Record<string, Array<() => void>>;
  append: (...children: FakeElement[]) => void;
  replaceChildren: (...children: FakeElement[]) => void;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  addEventListener: (name: string, listener: () => void) => void;
  click: () => void;
  change: (value: string) => void;
  querySelector: (selector: string) => FakeElement | null;
  querySelectorAll: (selector: string) => FakeElement[];
};

function createFakeDocument(): Document {
  const makeElement = (tagName: string): FakeElement => {
    const element: FakeElement = {
      tagName: tagName.toUpperCase(),
      id: "",
      className: "",
      textContent: "",
      value: "",
      disabled: false,
      hidden: false,
      children: [],
      parentElement: null,
      attributes: {} as Record<string, string>,
      listeners: {} as Record<string, Array<() => void>>,
      append(...children: FakeElement[]) {
        for (const child of children) {
          child.parentElement = element;
          element.children.push(child);
        }
      },
      replaceChildren(...children: FakeElement[]) {
        element.children = [];
        element.textContent = "";
        element.append(...children);
      },
      setAttribute(name: string, value: string) {
        element.attributes[name] = value;
        if (name === "id") element.id = value;
      },
      getAttribute(name: string) {
        return element.attributes[name] ?? null;
      },
      addEventListener(name: string, listener: () => void) {
        (element.listeners[name] ??= []).push(listener);
      },
      click() {
        for (const listener of element.listeners.click ?? []) listener();
      },
      change(value: string) {
        element.value = value;
        for (const listener of element.listeners.change ?? []) listener();
      },
      querySelector(selector: string) {
        return element.querySelectorAll(selector)[0] ?? null;
      },
      querySelectorAll(selector: string) {
        const matches: FakeElement[] = [];
        const visit = (candidate: FakeElement) => {
          const dataMatch = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
          const matchesCandidate = selector.startsWith("#")
            ? candidate.id === selector.slice(1)
            : dataMatch
              ? candidate.attributes[dataMatch[1]] === dataMatch[2]
              : selector.startsWith(".")
                ? candidate.className.split(" ").includes(selector.slice(1))
                : candidate.tagName === selector.toUpperCase();
          if (matchesCandidate) matches.push(candidate);
          for (const child of candidate.children) visit(child);
        };
        for (const child of element.children) visit(child);
        return matches;
      },
    };

    Object.defineProperty(element, "textContent", {
      get() {
        if (element.children.length === 0) return element.attributes.__text ?? "";
        return element.children.map((child) => child.textContent).join("");
      },
      set(value: string) {
        element.attributes.__text = value;
      },
    });
    return element;
  };

  return {
    createElement: (tagName: string) => makeElement(tagName),
    createTextNode: (value: string) => {
      const text = makeElement("span");
      text.textContent = value;
      return text;
    },
  } as unknown as Document;
}

function createSnapshot(): MemorySnapshot {
  return {
    l0: { preferredName: "Alex", longTermInterests: ["music"], permanentNotes: [] },
    l1: { currentProject: "Replica", recentGoals: [], recentPreferences: [] },
    l2: [
      {
        id: "memory-1",
        content: "I use TypeScript",
        confidence: 0.9,
        importance: "high",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
        lastAccessedAt: "2026-07-02T00:00:00.000Z",
        accessCount: 2,
        weight: 0.8,
        isPinned: false,
        isEnabled: true,
        status: "active",
        syncStatus: "synced",
        isSummary: false,
        evidenceCount: 1,
        sourceMemoryIds: [],
        conflictWith: [],
      },
      {
        id: "memory-2",
        content: "I prefer light mode",
        confidence: 0.7,
        importance: "medium",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        lastAccessedAt: "2026-07-01T00:00:00.000Z",
        accessCount: 1,
        weight: 0.95,
        isPinned: false,
        isEnabled: true,
        status: "active",
        syncStatus: "synced",
        isSummary: false,
        evidenceCount: 1,
        sourceMemoryIds: [],
        conflictWith: [],
      },
    ],
    conflicts: [{
      id: "conflict-1",
      sourceMemoryId: "memory-2",
      targetMemoryId: "memory-1",
      createdAt: "2026-07-03T00:00:00.000Z",
      status: "resolved",
      score: 85,
      priority: "high",
      attempts: 1,
      resolutionType: "preference_evolution",
      resolutionConfidence: 0.93,
      finishedAt: "2026-07-03T00:01:00.000Z",
    }],
    reflections: [],
    audit: [{
      id: "audit-1",
      createdAt: "2026-07-03T00:01:00.000Z",
      operation: "memory_conflict_resolution",
      targetType: "conflict",
      targetId: "conflict-1",
      source: "automatic",
      result: "success",
      code: "resolved",
    }],
    maintenance: { successfulWritesSinceMaintenance: 0, running: false },
  };
}

function createApi(snapshot: MemorySnapshot): MemoryApi {
  const success = async () => ({ ok: true as const, snapshot });
  return {
    getSnapshot: vi.fn(async () => snapshot),
    updateProfileField: vi.fn(success),
    updateL2: vi.fn(success),
    deleteProfileField: vi.fn(success),
    deleteL2: vi.fn(success),
    setL2Pinned: vi.fn(success),
    setL2Enabled: vi.fn(success),
    restoreL2: vi.fn(success),
    clearLayer: vi.fn(success),
    getAuditReport: vi.fn(async () => ({ ok: true, findings: [] })),
  };
}

describe("memory view", () => {
  it("keeps a reserved status row across loading, empty, and error states", async () => {
    const document = createFakeDocument();
    const root = document.createElement("section") as unknown as FakeElement;
    const api = createApi(createSnapshot());
    let resolveSnapshot: ((value: MemorySnapshot) => void) | undefined;
    api.getSnapshot = vi.fn(() => new Promise<MemorySnapshot>((resolve) => {
      resolveSnapshot = resolve;
    }));
    const view = mountMemoryView({ root: root as unknown as HTMLElement, api, document });

    const loading = view.show();
    expect(root.children).toHaveLength(4);
    expect(root.querySelector(".memory-status")?.textContent).toBe("Loading memory...");
    resolveSnapshot?.(createSnapshot());
    await loading;
    expect(root.children).toHaveLength(4);
    expect(root.querySelector(".memory-status")).not.toBeNull();

    api.getSnapshot = vi.fn(async () => {
      throw new Error("offline");
    });
    await view.refresh();
    expect(root.children).toHaveLength(4);
    expect(root.querySelector(".memory-status")?.textContent).toContain("could not be refreshed");
  });

  it("keeps empty and disabled panels in the same content layout", async () => {
    const document = createFakeDocument();
    const root = document.createElement("section") as unknown as FakeElement;
    const api = createApi({ ...createSnapshot(), l2: [] });
    const view = mountMemoryView({ root: root as unknown as HTMLElement, api, document });
    await view.show();
    root.querySelector('[data-memory-tab="events"]')?.click();
    expect(root.querySelector(".memory-content")).not.toBeNull();
    expect(root.querySelector(".memory-event-list")?.textContent).toContain("No memories match");
    expect(root.children).toHaveLength(4);

    root.querySelector('[data-memory-tab="relations"]')?.click();
    expect(root.querySelector(".memory-content")).not.toBeNull();
    expect(root.querySelector(".memory-state")?.getAttribute("aria-disabled")).toBe("false");
    expect(root.children).toHaveLength(4);
  });

  it("loads once when switched on and leaves chat messages untouched", async () => {
    const document = createFakeDocument();
    const root = document.createElement("section") as unknown as FakeElement;
    const messages = document.createElement("div");
    messages.textContent = "existing chat";
    const api = createApi(createSnapshot());
    const view = mountMemoryView({ root: root as unknown as HTMLElement, api, document });

    await view.show();
    await view.show();

    expect(api.getSnapshot).toHaveBeenCalledOnce();
    expect(messages.textContent).toBe("existing chat");
    expect(root.textContent).toContain("Memory");
  });

  it("refreshes the rendered snapshot after governance and resolver completion events", async () => {
    const document = createFakeDocument();
    const root = document.createElement("section") as unknown as FakeElement;
    const api = createApi(createSnapshot());
    const onAgentEvent = vi.fn();
    const view = mountMemoryView({ root: root as unknown as HTMLElement, api, document, onAgentEvent });
    await view.show();

    const listener = onAgentEvent.mock.calls[0]?.[0];
    listener({ runId: "run-1", event: createMemoryGovernanceChangedEvent({ changedCount: 1 }) });
    listener({ runId: "run-1", event: createMemoryResolverFinishedEvent({ conflictId: "conflict-1", status: "resolved" }) });
    await Promise.resolve();
    await Promise.resolve();

    expect(api.getSnapshot).toHaveBeenCalledTimes(3);
  });

  it("restores a superseded memory and refreshes its visible conflict state from governance events", async () => {
    const document = createFakeDocument();
    const root = document.createElement("section") as unknown as FakeElement;
    const before = createSnapshot();
    before.l2[0] = {
      ...before.l2[0],
      status: "superseded",
      isEnabled: false,
      supersededBy: "memory-2",
    };
    const after = createSnapshot();
    after.conflicts = [{
      id: "conflict-restored",
      sourceMemoryId: "memory-1",
      targetMemoryId: "memory-2",
      createdAt: "2026-07-04T00:00:00.000Z",
      status: "queued",
      score: 70,
      priority: "normal",
      attempts: 0,
    }];
    const api = createApi(before);
    api.restoreL2 = vi.fn(async () => ({ ok: true as const, snapshot: after }));
    api.getSnapshot = vi.fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValue(after);
    const onAgentEvent = vi.fn();
    const view = mountMemoryView({ root: root as unknown as HTMLElement, api, document, onAgentEvent });

    await view.show();
    root.querySelector('[data-memory-tab="events"]')?.click();
    root.querySelector('[data-action="restore-l2-memory-1"]')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(api.restoreL2).toHaveBeenCalledWith("memory-1");
    expect(root.querySelector('[data-action="restore-l2-memory-1"]')).toBeNull();
    const listener = onAgentEvent.mock.calls[0]?.[0];
    listener({ runId: "memory_restore_1", event: createMemoryGovernanceChangedEvent({ changedCount: 1 }) });
    await Promise.resolve();
    await Promise.resolve();

    root.querySelector('[data-memory-tab="conflicts"]')?.click();
    expect(api.getSnapshot).toHaveBeenCalledTimes(2);
    expect(root.textContent).toContain("conflict-restored");
  });

  it("renders profile fields and saves through updateProfileField", async () => {
    const document = createFakeDocument();
    const root = document.createElement("section") as unknown as FakeElement;
    const api = createApi(createSnapshot());
    const view = mountMemoryView({ root: root as unknown as HTMLElement, api, document });
    await view.show();
    root.querySelector('[data-memory-tab="profile"]')?.click();

    const input = root.querySelector('[data-memory-field="preferredName"]') as unknown as FakeElement;
    expect(input.id).toBe("memory-field-L0-preferredName");
    expect(root.querySelectorAll("label").some((label) => label.getAttribute("for") === "memory-field-L0-preferredName")).toBe(true);
    input.value = "Morgan";
    root.querySelector('[data-action="save-profile-preferredName"]')?.click();
    await Promise.resolve();

    expect(api.updateProfileField).toHaveBeenCalledWith({ layer: "L0", field: "preferredName", value: "Morgan" });
  });

  it("wires the visible Events sort control to model ordering", async () => {
    const document = createFakeDocument();
    const root = document.createElement("section") as unknown as FakeElement;
    const api = createApi(createSnapshot());
    const view = mountMemoryView({ root: root as unknown as HTMLElement, api, document });
    await view.show();
    root.querySelector('[data-memory-tab="events"]')?.click();

    const sort = root.querySelector('[aria-label="Sort by"]') as unknown as FakeElement;
    expect(sort).not.toBeNull();
    expect(root.querySelectorAll("article")[0]?.getAttribute("data-memory-row")).toBe("memory-1");
    sort.change("weight");
    expect(root.querySelectorAll("article")[0]?.getAttribute("data-memory-row")).toBe("memory-2");
  });

  it("exits L2 edit mode only after a successful save and rerender", async () => {
    const document = createFakeDocument();
    const root = document.createElement("section") as unknown as FakeElement;
    const api = createApi(createSnapshot());
    const updated = createSnapshot();
    updated.l2[0].content = "I use TypeScript every day";
    api.updateL2 = vi.fn(async () => ({ ok: true as const, snapshot: updated }));
    const view = mountMemoryView({ root: root as unknown as HTMLElement, api, document });
    await view.show();
    root.querySelector('[data-memory-tab="events"]')?.click();
    root.querySelector('[data-action="edit-l2-memory-1"]')?.click();
    const editor = root.querySelector('[data-action="save-l2-memory-1"]');
    expect(editor).not.toBeNull();
    root.querySelector(".memory-edit-input")!.value = "I use TypeScript every day";
    editor?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.querySelector('[data-action="edit-l2-memory-1"]')).not.toBeNull();
    expect(root.querySelector(".memory-edit-input")).toBeNull();
    expect(root.textContent).toContain("I use TypeScript every day");
  });

  it("provides event controls and confirms destructive actions", async () => {
    const document = createFakeDocument();
    const root = document.createElement("section") as unknown as FakeElement;
    const api = createApi(createSnapshot());
    const confirm = vi.fn(() => false);
    const view = mountMemoryView({ root: root as unknown as HTMLElement, api, confirm, document });
    await view.show();
    root.querySelector('[data-memory-tab="events"]')?.click();

    expect(root.querySelector('[data-action="edit-l2-memory-1"]')).not.toBeNull();
    expect(root.querySelector('[data-action="delete-l2-memory-1"]')).not.toBeNull();
    expect(root.querySelector('[data-action="pin-l2-memory-1"]')).not.toBeNull();
    expect(root.querySelector('[data-action="enable-l2-memory-1"]')).not.toBeNull();
    root.querySelector('[data-action="delete-l2-memory-1"]')?.click();
    root.querySelector('[data-action="clear-layer-L2"]')?.click();
    await Promise.resolve();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(api.deleteL2).not.toHaveBeenCalled();
    expect(api.clearLayer).not.toHaveBeenCalled();
  });

  it("renders complete conflict and audit metadata with text nodes only", async () => {
    const document = createFakeDocument();
    const root = document.createElement("section") as unknown as FakeElement;
    const api = createApi(createSnapshot());
    api.getAuditReport = vi.fn(async () => ({
      ok: true,
      findings: [{ code: "missing_evidence", severity: "warning", targetId: "memory-2" }],
    } satisfies Awaited<ReturnType<MemoryApi["getAuditReport"]>>));
    const view = mountMemoryView({ root: root as unknown as HTMLElement, api, document });
    await view.show();

    root.querySelector('[data-memory-tab="conflicts"]')?.click();
    expect(root.textContent).toContain("Score 85.00");
    expect(root.textContent).toContain("Priority high");
    expect(root.textContent).toContain("State resolved");
    expect(root.textContent).toContain("Resolution preference_evolution");
    expect(root.textContent).toContain("Confidence 0.93");
    expect(root.textContent).toContain("Created 2026-07-03T00:00:00.000Z");
    expect(root.textContent).toContain("Finished 2026-07-03T00:01:00.000Z");

    root.querySelector('[data-memory-tab="audit"]')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(root.textContent).toContain("memory_conflict_resolution");
    expect(root.textContent).toContain("success | conflict | conflict-1");
    expect(root.textContent).toContain("Code resolved");
    expect(root.textContent).toContain("missing_evidence | warning | memory-2");
  });

  it("renders reflection provenance and derived relation tables", async () => {
    const document = createFakeDocument();
    const root = document.createElement("section") as unknown as FakeElement;
    const snapshot = createSnapshot();
    snapshot.reflections.push({ id: "reflection-1", createdAt: "2026-07-16T00:00:00.000Z", type: "l0_update", field: "occupation", sourceMemoryIds: ["memory-1"], acceptedCount: 1, skippedCount: 0 });
    snapshot.entityGraph = {
      generatedAt: "2026-07-16T00:00:00.000Z",
      nodes: [
        { id: "technology:typescript", type: "technology", name: "TypeScript", sourceMemoryIds: ["memory-1"] },
        { id: "project:agent-lab", type: "project", name: "Agent Lab", sourceMemoryIds: ["memory-1"] },
      ],
      relations: [{ id: "r1", fromId: "technology:typescript", toId: "project:agent-lab", type: "used_in", sourceMemoryIds: ["memory-1"] }],
    };
    const view = mountMemoryView({ root: root as unknown as HTMLElement, api: createApi(snapshot), document });
    await view.show();
    root.querySelector('[data-memory-tab="reflections"]')?.click();
    expect(root.textContent).toContain("occupation");
    expect(root.textContent).toContain("Sources: memory-1");
    root.querySelector('[data-memory-tab="relations"]')?.click();
    expect(root.textContent).toContain("TypeScript -> Agent Lab");
    expect(root.textContent).toContain("used_in");
    expect(root.querySelector('[aria-label="Filter entities and relations"]')).not.toBeNull();
  });

  it("rolls back failed mutations and displays a safe error", async () => {
    const document = createFakeDocument();
    const root = document.createElement("section") as unknown as FakeElement;
    const snapshot = createSnapshot();
    const api = createApi(snapshot);
    api.setL2Pinned = vi.fn(async () => ({ ok: false as const, code: "invalid_state" as const, message: "secret detail" }));
    const view = mountMemoryView({ root: root as unknown as HTMLElement, api, document });
    await view.show();
    root.querySelector('[data-memory-tab="events"]')?.click();
    root.querySelector('[data-action="pin-l2-memory-1"]')?.click();
    await Promise.resolve();

    expect(root.textContent).toContain("This memory is not available for that action.");
    expect(root.textContent).not.toContain("secret detail");
    expect(root.textContent).toContain("I use TypeScript");
    expect(root.querySelector('[data-action="pin-l2-memory-1"]')?.textContent).toBe("Pin");
  });
});
