import { describe, expect, it, vi } from "vitest";
import type { MemoryApi, MemorySnapshot } from "../../src/shared/memory-api-types.js";
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
    l2: [{
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
    }],
    conflicts: [],
    reflections: [],
    audit: [],
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

  it("renders profile fields and saves through updateProfileField", async () => {
    const document = createFakeDocument();
    const root = document.createElement("section") as unknown as FakeElement;
    const api = createApi(createSnapshot());
    const view = mountMemoryView({ root: root as unknown as HTMLElement, api, document });
    await view.show();
    root.querySelector('[data-memory-tab="profile"]')?.click();

    const input = root.querySelector('[data-memory-field="preferredName"]') as unknown as FakeElement;
    input.value = "Morgan";
    root.querySelector('[data-action="save-profile-preferredName"]')?.click();
    await Promise.resolve();

    expect(api.updateProfileField).toHaveBeenCalledWith({ layer: "L0", field: "preferredName", value: "Morgan" });
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
    await Promise.resolve();
    expect(confirm).toHaveBeenCalledOnce();
    expect(api.deleteL2).not.toHaveBeenCalled();
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
  });
});
