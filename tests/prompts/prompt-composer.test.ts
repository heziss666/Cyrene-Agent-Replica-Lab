import { describe, expect, it, vi } from "vitest";
import {
  STYLE_OPTIONS,
  getStyleOption,
  isStyleId,
} from "../../src/shared/persona-types.js";
import { createPromptComposer } from "../../src/main/prompts/prompt-composer.js";

const prompts: Record<string, string> = {
  "system.md": "CURRENCY_WAR_SYSTEM",
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
  it("uses the 4.4–4.7 currency war content cycle in the real system prompt", () => {
    const prompt = createPromptComposer().composeSystemPrompt({ styleId: "default" });
    expect(prompt).toContain("4.4–4.7");
    expect(prompt).toContain("结构化数据基线来自 4.4");
    expect(prompt).not.toContain("当前项目资料对应的 4.4 版本");
  });

  it("requires local evidence for every concrete currency war fact", () => {
    const prompt = createPromptComposer().composeSystemPrompt({ styleId: "default" });

    expect(prompt).toContain("没有证据，不得陈述");
    expect(prompt).toContain("lookup_currency_war_data");
    expect(prompt).toContain("字段为 `null`");
    expect(prompt).toContain("【基础库】");
    expect(prompt).toContain("【攻略 Skill】");
    expect(prompt).toContain("【策略推导】");
    expect(prompt).toContain("不得使用预训练记忆");
  });

  it("eagerly loads all prompt assets and composes them in a stable order", () => {
    const readPrompt = vi.fn((path: string) => prompts[path] ?? "");
    const composer = createPromptComposer({ readPrompt });

    expect(readPrompt).toHaveBeenCalledTimes(6);
    expect(readPrompt).not.toHaveBeenCalledWith("identity.md");
    expect(readPrompt).not.toHaveBeenCalledWith("soul.md");
    expect(readPrompt).not.toHaveBeenCalledWith("tone-rules.md");
    expect(composer.composeSystemPrompt({ styleId: "healing" })).toBe(
      ["CURRENCY_WAR_SYSTEM", "HEALING"].join("\n\n---\n\n"),
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

  it("fails during construction when the currency war system prompt is missing", () => {
    expect(() => createPromptComposer({
      readPrompt: (path) => path === "system.md" ? "" : (prompts[path] ?? ""),
    })).toThrow("Required prompt file is missing or empty: system.md");
  });
});
