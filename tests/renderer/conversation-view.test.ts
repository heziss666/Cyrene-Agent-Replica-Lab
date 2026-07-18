import { describe, expect, it, vi } from "vitest";
import { mountConversationView } from "../../src/renderer/chat/conversation-view.js";
import type { ConversationListItem } from "../../src/shared/conversation-types.js";

type FakeElement = {
  tagName: string; className: string; textContent: string; value: string; children: FakeElement[];
  listeners: Record<string, Array<() => void | Promise<void>>>;
  append(...children: FakeElement[]): void; replaceChildren(...children: FakeElement[]): void;
  setAttribute(name: string, value: string): void;
  addEventListener(name: string, listener: () => void | Promise<void>): void;
  querySelectorAll(selector: string): FakeElement[];
};

function fakeDocument(): Document {
  const create = (tagName: string): FakeElement => {
    const element: FakeElement = { tagName: tagName.toUpperCase(), className: "", textContent: "", value: "", children: [], listeners: {}, append(...children) { element.children.push(...children); }, replaceChildren(...children) { element.children = children; }, setAttribute() {}, addEventListener(name, listener) { (element.listeners[name] ??= []).push(listener); }, querySelectorAll(selector) { const found: FakeElement[] = []; const visit = (node: FakeElement) => { if (selector.startsWith(".") && node.className.split(" ").includes(selector.slice(1))) found.push(node); if (!selector.startsWith(".") && node.tagName === selector.toUpperCase()) found.push(node); node.children.forEach(visit); }; element.children.forEach(visit); return found; } };
    return element;
  };
  return { createElement: create } as unknown as Document;
}

const item: ConversationListItem = { id: "conv_1", title: "Agent memory", preview: "Explain L2", createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T01:00:00.000Z", styleId: "default", messageCount: 2, hasPendingRun: false };
const allText = (element: FakeElement): string => element.textContent + element.children.map(allText).join("");

describe("conversation view", () => {
  it("renders conversations and wires create/select commands", async () => {
    const document = fakeDocument();
    const root = document.createElement("aside") as unknown as FakeElement;
    const onCreate = vi.fn(async () => undefined);
    const onSelect = vi.fn(async () => undefined);
    const view = mountConversationView({ root: root as unknown as HTMLElement, document, onCreate, onSelect, onRename: vi.fn(), onRemove: vi.fn() });

    view.render({ conversations: [item], activeConversationId: "conv_1", unreadConversationIds: [] });
    expect(root.querySelectorAll("button").some((button) => allText(button).includes("Agent memory"))).toBe(true);
    await root.querySelectorAll(".conversation-new-button")[0].listeners.click[0]();
    await root.querySelectorAll(".conversation-select-button")[0].listeners.click[0]();
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("conv_1");
  });
});
