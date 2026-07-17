import { describe, expect, it } from "vitest";
import { parseSkillCommand } from "../../src/main/skills/skill-command.js";
import type { SkillEntry } from "../../src/main/skills/skill-types.js";

const tutor = {
  id: "tutor",
  enabled: true,
  available: true,
} as SkillEntry;

describe("parseSkillCommand", () => {
  it("extracts a known usable skill from the first token", () => {
    expect(parseSkillCommand("/tutor explain ToolRegistry", [tutor])).toEqual({
      kind: "activated",
      skillId: "tutor",
      text: "explain ToolRegistry",
    });
  });

  it("rejects an empty task after a known skill command", () => {
    expect(parseSkillCommand("/tutor", [tutor])).toEqual({
      kind: "error",
      code: "SKILL_TASK_REQUIRED",
    });
  });

  it("leaves normal text and unknown slash commands unchanged", () => {
    expect(parseSkillCommand("hello", [tutor])).toEqual({ kind: "none", text: "hello" });
    expect(parseSkillCommand("/unknown hello", [tutor])).toEqual({
      kind: "none",
      text: "/unknown hello",
    });
  });
});
