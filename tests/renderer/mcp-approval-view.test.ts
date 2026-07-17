import { describe, expect, it, vi } from "vitest";
import { mountMcpApprovalView } from "../../src/renderer/chat/mcp-approval-view.js";
import type { McpApi, McpApprovalListener } from "../../src/shared/mcp-api-types.js";

type FakeElement = {
  tagName: string; textContent: string; className: string; hidden: boolean;
  children: FakeElement[]; listeners: Record<string, Array<() => void | Promise<void>>>;
  append(...children: FakeElement[]): void; replaceChildren(...children: FakeElement[]): void;
  addEventListener(name: string, listener: () => void | Promise<void>): void;
  setAttribute(name: string, value: string): void; focus(): void; click(): void;
  querySelectorAll(selector: string): FakeElement[];
};

function fakeDocument(): Document {
  const create = (tag: string): FakeElement => {
    const element: FakeElement = {
      tagName: tag.toUpperCase(), textContent: "", className: "", hidden: false,
      children: [], listeners: {},
      append(...children) { element.children.push(...children); },
      replaceChildren(...children) { element.children = children; },
      addEventListener(name, listener) { (element.listeners[name] ??= []).push(listener); },
      setAttribute() {}, focus() {}, click() { void element.listeners.click?.[0]?.(); },
      querySelectorAll(selector) {
        const result: FakeElement[] = [];
        const visit = (node: FakeElement) => {
          if (node.tagName === selector.toUpperCase()) result.push(node);
          node.children.forEach(visit);
        };
        element.children.forEach(visit);
        return result;
      },
    };
    return element;
  };
  return {
    createElement: create,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as Document;
}

function allText(element: FakeElement): string {
  return `${element.textContent}${element.children.map(allText).join("")}`;
}

describe("MCP approval view", () => {
  it("renders a request and resolves allow or deny", async () => {
    let listener: McpApprovalListener | undefined;
    const resolveApproval = vi.fn(async () => ({ resolved: true }));
    const api = {
      onApprovalRequested: (next: McpApprovalListener) => { listener = next; return () => undefined; },
      resolveApproval,
    } as Pick<McpApi, "onApprovalRequested" | "resolveApproval">;
    const document = fakeDocument();
    const root = document.createElement("div") as unknown as FakeElement;
    const view = mountMcpApprovalView({ root: root as unknown as HTMLElement, api, document });

    listener?.({
      id: "approval-1", serverId: "demo", toolId: "demo__write",
      toolName: "write", args: { path: "a.txt" }, risk: "sensitive",
    });
    expect(allText(root)).toContain("demo__write");
    expect(allText(root)).toContain("a.txt");
    const buttons = root.querySelectorAll("button");
    buttons[1]!.click();
    await Promise.resolve();
    expect(resolveApproval).toHaveBeenCalledWith("approval-1", true);
    view.dispose();
  });
});
