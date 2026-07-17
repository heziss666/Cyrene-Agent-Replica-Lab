import { describe, expect, it, vi } from "vitest";
import { mountSkillsView } from "../../src/renderer/chat/skills-view.js";
import type { SkillsApi, SkillsSnapshot } from "../../src/shared/skill-api-types.js";

type FakeElement = {
  tagName: string;
  className: string;
  textContent: string;
  disabled: boolean;
  checked: boolean;
  children: FakeElement[];
  listeners: Record<string, Array<() => void | Promise<void>>>;
  append(...children: FakeElement[]): void;
  replaceChildren(...children: FakeElement[]): void;
  addEventListener(name: string, listener: () => void | Promise<void>): void;
  querySelectorAll(selector: string): FakeElement[];
};

function fakeDocument(): Document {
  const create = (tagName: string): FakeElement => {
    const element: FakeElement = {
      tagName: tagName.toUpperCase(),
      className: "",
      textContent: "",
      disabled: false,
      checked: false,
      children: [],
      listeners: {},
      append(...children) { element.children.push(...children); },
      replaceChildren(...children) { element.children = children; element.textContent = ""; },
      addEventListener(name, listener) { (element.listeners[name] ??= []).push(listener); },
      querySelectorAll(selector) {
        const result: FakeElement[] = [];
        const visit = (node: FakeElement) => {
          if (selector.startsWith(".") && node.className.split(" ").includes(selector.slice(1))) result.push(node);
          if (!selector.startsWith(".") && node.tagName === selector.toUpperCase()) result.push(node);
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

function snapshot(enabled = true): SkillsSnapshot {
  return {
    skills: [{
      id: "tutor",
      name: "Tutor",
      description: "Teach the project.",
      requiredTools: ["search_knowledge"],
      source: "builtin",
      references: ["workflow.md"],
      defaultEnabled: true,
      enabled,
      available: true,
      unavailableReasons: [],
    }],
    diagnostics: [],
  };
}

function allText(element: FakeElement): string {
  return `${element.textContent}${element.children.map(allText).join("")}`;
}

describe("mountSkillsView", () => {
  it("loads skills and wires enable and reload actions", async () => {
    const document = fakeDocument();
    const root = document.createElement("section") as unknown as FakeElement;
    const api: SkillsApi = {
      list: vi.fn(async () => snapshot()),
      setEnabled: vi.fn(async () => snapshot(false)),
      reload: vi.fn(async () => snapshot()),
    };
    const view = mountSkillsView({
      root: root as unknown as HTMLElement,
      api,
      document,
    });

    await view.show();
    expect(allText(root)).toContain("Tutor");
    expect(allText(root)).toContain("search_knowledge");
    const checkbox = root.querySelectorAll("input")[0]!;
    checkbox.checked = false;
    await checkbox.listeners.change![0]!();
    expect(api.setEnabled).toHaveBeenCalledWith("tutor", false);
    const reload = root.querySelectorAll("button")[0]!;
    await reload.listeners.click![0]!();
    expect(api.reload).toHaveBeenCalledOnce();
  });
});
