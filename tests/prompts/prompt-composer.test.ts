import { describe, expect, it, vi } from "vitest";
import {
  STYLE_OPTIONS,
  getStyleOption,
  isStyleId,
} from "../../src/shared/persona-types.js";
import { createPromptComposer } from "../../src/main/prompts/prompt-composer.js";

const prompts: Record<string, string> = {
  "runtime-system.md": "SYSTEM",
  "identity.md": "IDENTITY",
  "soul.md": "SOUL",
  "tone-rules.md": "TONE",
  "styles/01_default.md": "DEFAULT",
  "styles/02_lively.md": "LIVELY",
  "styles/03_healing.md": "HEALING",
  "styles/04_focused.md": "FOCUSED",
  "styles/05_sweet.md": "SWEET",
};

describe("persona style types", () => {
  it("defines the five stable style ids", () => {
    expect(STYLE_OPTIONS.map((option) => option.id)).toEqual([
      "default",
      "lively",
      "healing",
      "focused",
      "sweet",
    ]);
    expect(isStyleId("healing")).toBe(true);
    expect(isStyleId("phone")).toBe(false);
    expect(getStyleOption("focused").label).toBe("知性认真");
  });
});

describe("createPromptComposer", () => {
  it("eagerly loads all prompt assets and composes them in a stable order", () => {
    const readPrompt = vi.fn((path: string) => prompts[path] ?? "");
    const composer = createPromptComposer({ readPrompt });

    expect(readPrompt).toHaveBeenCalledTimes(9);
    expect(composer.composeSystemPrompt({ styleId: "healing" })).toBe(
      ["SYSTEM", "IDENTITY", "SOUL", "TONE", "HEALING"].join("\n\n---\n\n"),
    );
  });

  it("appends a one-request style transition after the active style", () => {
    const composer = createPromptComposer({
      readPrompt: (path) => prompts[path] ?? "",
    });

    const result = composer.composeSystemPrompt({
      styleId: "healing",
      transition: { from: "default", to: "healing" },
    });

    expect(result).toContain("回复风格已从“温柔和善”切换为“治愈安心”");
    expect(result.indexOf("HEALING")).toBeLessThan(result.indexOf("本轮内部风格切换提醒"));
  });

  it("fails during construction when a required style asset is missing", () => {
    expect(() => createPromptComposer({
      readPrompt: (path) => path === "styles/05_sweet.md" ? "" : (prompts[path] ?? ""),
    })).toThrow("Required prompt file is missing or empty: styles/05_sweet.md");
  });
});
