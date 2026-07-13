import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve("resources/cyrene");
const required = [
  "prompts/source/system.md",
  "prompts/runtime-system.md",
  "prompts/identity.md",
  "prompts/soul.md",
  "prompts/tone-rules.md",
  "prompts/styles/01_default.md",
  "prompts/styles/02_lively.md",
  "prompts/styles/03_healing.md",
  "prompts/styles/04_focused.md",
  "prompts/styles/05_sweet.md",
  "knowledge/canon_quotes.md",
  "knowledge/worldbook/_glossary.md",
  "knowledge/worldbook/Cyrene.md",
  "knowledge/worldbook/characters.md",
  "knowledge/worldbook/story.md",
  "knowledge/worldbook/world.md",
  "inactive-skills/cyrene-original-voice/SKILL.md",
  "ORIGIN.md",
  "LICENSE.upstream",
];

describe("Cyrene resource snapshot", () => {
  it.each(required)("contains non-empty UTF-8 resource %s", (relativePath) => {
    expect(readFileSync(resolve(root, relativePath), "utf8").trim().length).toBeGreaterThan(0);
  });

  it("does not import phone or talk prompts", () => {
    expect(() => readFileSync(resolve(root, "prompts/phone_system.md"), "utf8")).toThrow();
    expect(() => readFileSync(resolve(root, "prompts/talk_system.md"), "utf8")).toThrow();
  });
});
