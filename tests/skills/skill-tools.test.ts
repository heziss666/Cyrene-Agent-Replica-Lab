import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../src/main/agent/agent-events.js";
import { registerSkillTools } from "../../src/main/skills/skill-tools.js";
import { ToolRegistry } from "../../src/main/tools/tool-registry.js";

function setup() {
  const skills = {
    get: vi.fn((id: string) => id === "tutor" ? {
      id: "tutor",
      references: [{ name: "guide.md" }],
      enabled: true,
      available: true,
    } : undefined),
    readBody: vi.fn(async () => "Teach step by step."),
    readReference: vi.fn(async (_id: string, name: string) => `Reference: ${name}`),
  };
  const registry = new ToolRegistry();
  registerSkillTools(registry, skills);
  return { registry, skills };
}

describe("registerSkillTools", () => {
  it("loads a skill body once per agent run and emits activation", async () => {
    const { registry, skills } = setup();
    const tool = registry.getById("invoke_skill")!;
    const events: AgentEvent[] = [];
    const context = { runState: new Map<string, unknown>(), emitEvent: (event: AgentEvent) => events.push(event) };

    const first = await tool.execute({ skill_id: "tutor" }, context);
    const duplicate = await tool.execute({ skill_id: "tutor" }, context);

    expect(first).toContain("Teach step by step.");
    expect(first).toContain("guide.md");
    expect(duplicate).toBe("[skill already activated: tutor]");
    expect(skills.readBody).toHaveBeenCalledOnce();
    expect(events).toEqual([{ type: "skill_activated", skillId: "tutor" }]);
  });

  it("loads only whitelisted references once per run", async () => {
    const { registry, skills } = setup();
    const tool = registry.getById("read_skill_reference")!;
    const events: AgentEvent[] = [];
    const context = { runState: new Map<string, unknown>(), emitEvent: (event: AgentEvent) => events.push(event) };

    expect(await tool.execute({ skill_id: "tutor", reference: "guide.md" }, context))
      .toBe("Reference: guide.md");
    expect(await tool.execute({ skill_id: "tutor", reference: "guide.md" }, context))
      .toBe("[skill reference already loaded: tutor/guide.md]");
    expect(skills.readReference).toHaveBeenCalledOnce();
    expect(events).toEqual([{
      type: "skill_reference_loaded",
      skillId: "tutor",
      reference: "guide.md",
    }]);
  });

  it("returns stable errors and emits no local paths", async () => {
    const { registry } = setup();
    const tool = registry.getById("invoke_skill")!;
    const events: AgentEvent[] = [];
    const context = { runState: new Map<string, unknown>(), emitEvent: (event: AgentEvent) => events.push(event) };

    expect(await tool.execute({ skill_id: "missing" }, context)).toBe("[error] SKILL_NOT_FOUND");
    expect(events).toEqual([{
      type: "skill_load_failed",
      skillId: "missing",
      code: "SKILL_NOT_FOUND",
    }]);
    expect(JSON.stringify(events)).not.toContain("C:\\");
  });
});
