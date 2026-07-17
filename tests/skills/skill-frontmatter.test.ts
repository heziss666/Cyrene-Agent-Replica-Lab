import { describe, expect, it } from "vitest";
import { parseSkillDocument } from "../../src/main/skills/skill-frontmatter.js";

describe("parseSkillDocument", () => {
  it("parses structured frontmatter and body", () => {
    const result = parseSkillDocument(`---
name: Agent Tutor
description: Explain this project clearly.
version: 1.0.0
defaultEnabled: false
tools:
  - search_knowledge
---
# Instructions

Teach step by step.
`);

    expect(result).toEqual({
      name: "Agent Tutor",
      description: "Explain this project clearly.",
      version: "1.0.0",
      defaultEnabled: false,
      requiredTools: ["search_knowledge"],
      body: "# Instructions\n\nTeach step by step.",
    });
  });

  it("defaults tools and defaultEnabled", () => {
    const result = parseSkillDocument(`---
name: Minimal
description: A minimal skill.
---
Do the task.
`);

    expect(result.requiredTools).toEqual([]);
    expect(result.defaultEnabled).toBe(true);
  });

  it.each([
    ["missing name", "---\ndescription: valid\n---\nbody", "SKILL_NAME_REQUIRED"],
    ["duplicate tools", "---\nname: valid\ndescription: valid\ntools: [echo, echo]\n---\nbody", "SKILL_TOOLS_DUPLICATED"],
    ["invalid default", "---\nname: valid\ndescription: valid\ndefaultEnabled: yes\n---\nbody", "SKILL_DEFAULT_ENABLED_INVALID"],
    ["long description", `---\nname: valid\ndescription: ${"a".repeat(501)}\n---\nbody`, "SKILL_DESCRIPTION_TOO_LARGE"],
    ["long body", `---\nname: valid\ndescription: valid\n---\n${"a".repeat(16_001)}`, "SKILL_BODY_TOO_LARGE"],
  ])("rejects %s", (_name, content, code) => {
    expect(() => parseSkillDocument(content)).toThrow(code);
  });
});
