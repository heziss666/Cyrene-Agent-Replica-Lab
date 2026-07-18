import { describe, expect, it } from "vitest";
import { createActivityDrawer, type ActivityDrawerElement } from "../../src/renderer/chat/activity-drawer.js";

function element(): ActivityDrawerElement & { getAttribute(name: string): string | null; hasClass(name: string): boolean } {
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  return {
    hidden: false,
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    hasClass(name) {
      return classes.has(name);
    },
  };
}

describe("activity drawer", () => {
  it("starts closed and synchronizes accessible state", () => {
    const drawer = element();
    const toggle = element();
    const controller = createActivityDrawer({ drawer, toggle });

    expect(drawer.hidden).toBe(true);
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    controller.open();
    expect(drawer.hidden).toBe(false);
    expect(drawer.hasClass("is-open")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("marks the toggle when an event needs attention", () => {
    const drawer = element();
    const toggle = element();
    const controller = createActivityDrawer({ drawer, toggle });

    controller.setAttention(true);
    expect(toggle.hasClass("has-attention")).toBe(true);
    controller.open();
    expect(toggle.hasClass("has-attention")).toBe(false);
  });
});
