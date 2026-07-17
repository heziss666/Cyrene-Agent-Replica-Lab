import { describe, expect, it, vi } from "vitest";
import { mountMcpView } from "../../src/renderer/chat/mcp-view.js";
import type { McpApi, McpSnapshotView } from "../../src/shared/mcp-api-types.js";

type FakeElement = {
  tagName: string; className: string; textContent: string; disabled: boolean;
  checked: boolean; value: string; hidden: boolean; children: FakeElement[];
  listeners: Record<string, Array<() => void | Promise<void>>>;
  append(...children: FakeElement[]): void; replaceChildren(...children: FakeElement[]): void;
  addEventListener(name: string, listener: () => void | Promise<void>): void;
  querySelectorAll(selector: string): FakeElement[];
};

function fakeDocument(): Document {
  const create = (tag: string): FakeElement => {
    const element: FakeElement = {
      tagName: tag.toUpperCase(), className: "", textContent: "", disabled: false,
      checked: false, value: "", hidden: false, children: [], listeners: {},
      append(...children) { element.children.push(...children); },
      replaceChildren(...children) { element.children = children; },
      addEventListener(name, listener) { (element.listeners[name] ??= []).push(listener); },
      querySelectorAll(selector) {
        const result: FakeElement[] = [];
        const visit = (node: FakeElement) => {
          if (selector.startsWith(".") && node.className.split(" ").includes(selector.slice(1))) result.push(node);
          else if (!selector.startsWith(".") && node.tagName === selector.toUpperCase()) result.push(node);
          node.children.forEach(visit);
        };
        element.children.forEach(visit);
        return result;
      },
    };
    return element;
  };
  return { createElement: create } as unknown as Document;
}

const snapshot: McpSnapshotView = {
  servers: [{
    id: "demo", name: "Demo", transport: "stdio", enabled: true,
    trust: "ask-sensitive", status: "connected", toolCount: 1,
    command: "node", args: [], env: {},
    tools: [{ id: "demo__read", name: "read", description: "Read", enabled: true, risk: "read" }],
  }],
};

function api(): McpApi {
  return {
    list: vi.fn(async () => snapshot), add: vi.fn(async () => snapshot),
    update: vi.fn(async () => snapshot), remove: vi.fn(async () => snapshot),
    reconnect: vi.fn(async () => snapshot), setEnabled: vi.fn(async () => snapshot),
    setToolOptions: vi.fn(async () => snapshot), onApprovalRequested: () => () => undefined,
    resolveApproval: vi.fn(async () => ({ resolved: true })),
  };
}

function allText(element: FakeElement): string {
  return `${element.textContent}${element.children.map(allText).join("")}`;
}

describe("MCP view", () => {
  it("loads servers and wires enable and reconnect actions", async () => {
    const document = fakeDocument();
    const root = document.createElement("section") as unknown as FakeElement;
    const mcp = api();
    const view = mountMcpView({ root: root as unknown as HTMLElement, api: mcp, document });

    await view.show();
    expect(allText(root)).toContain("Demo");
    expect(allText(root)).toContain("read");
    const checkbox = root.querySelectorAll("input").find((item) => item.listeners.change?.length)!;
    checkbox.checked = false;
    await checkbox.listeners.change![0]!();
    expect(mcp.setEnabled).toHaveBeenCalledWith("demo", false);
    const reconnect = root.querySelectorAll(".mcp-reconnect")[0]!;
    await reconnect.listeners.click![0]!();
    expect(mcp.reconnect).toHaveBeenCalledWith("demo");
  });
});
