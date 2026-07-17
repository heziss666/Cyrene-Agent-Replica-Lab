import type { AgentEvent } from "../agent/agent-events.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import type { ToolDefinition, ToolExecutionContext } from "../tools/tool-types.js";
import type { SkillEntry } from "./skill-types.js";

export interface SkillToolRegistry {
  get(id: string): (Pick<SkillEntry, "id" | "enabled" | "available"> & {
    references: Array<{ name: string }>;
  }) | undefined;
  readBody(id: string): Promise<string>;
  readReference(id: string, name: string): Promise<string>;
}

function stringArg(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function stateSet(context: ToolExecutionContext | undefined, key: string): Set<string> {
  if (!context) return new Set<string>();
  const current = context.runState.get(key);
  if (current instanceof Set) return current as Set<string>;
  const created = new Set<string>();
  context.runState.set(key, created);
  return created;
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^SKILL_[A-Z_]+$/.test(message) ? message : "SKILL_LOAD_FAILED";
}

function emit(context: ToolExecutionContext | undefined, event: AgentEvent): void {
  context?.emitEvent(event);
}

export function registerSkillTools(
  toolRegistry: ToolRegistry,
  skillRegistry: SkillToolRegistry,
): void {
  const invokeSkill: ToolDefinition = {
    id: "invoke_skill",
    description: "Load the full instructions for an enabled local skill before following it.",
    enabled: true,
    parameters: {
      type: "object",
      properties: {
        skill_id: { type: "string", description: "Skill ID from the Available Skills catalog." },
      },
      required: ["skill_id"],
    },
    execute: async (args, context) => {
      let skillId = "unknown";
      try {
        skillId = stringArg(args.skill_id, "SKILL_ID_REQUIRED");
        const loaded = stateSet(context, "skills:activated");
        if (loaded.has(skillId)) return `[skill already activated: ${skillId}]`;
        const skill = skillRegistry.get(skillId);
        if (!skill) throw new Error("SKILL_NOT_FOUND");
        const body = await skillRegistry.readBody(skillId);
        loaded.add(skillId);
        emit(context, { type: "skill_activated", skillId });
        const references = skill.references.length > 0
          ? `\n\nAvailable references:\n${skill.references.map((item) => `- ${item.name}`).join("\n")}`
          : "";
        return `Skill: ${skillId}\n\n${body}${references}`;
      } catch (error) {
        const code = errorCode(error);
        emit(context, { type: "skill_load_failed", skillId, code });
        return `[error] ${code}`;
      }
    },
  };

  const readReference: ToolDefinition = {
    id: "read_skill_reference",
    description: "Read one whitelisted reference file belonging to an enabled local skill.",
    enabled: true,
    parameters: {
      type: "object",
      properties: {
        skill_id: { type: "string", description: "Owner skill ID." },
        reference: { type: "string", description: "Reference name listed by invoke_skill." },
      },
      required: ["skill_id", "reference"],
    },
    execute: async (args, context) => {
      let skillId = "unknown";
      try {
        skillId = stringArg(args.skill_id, "SKILL_ID_REQUIRED");
        const reference = stringArg(args.reference, "SKILL_REFERENCE_REQUIRED");
        const key = `${skillId}/${reference}`;
        const loaded = stateSet(context, "skills:references");
        if (loaded.has(key)) return `[skill reference already loaded: ${key}]`;
        const content = await skillRegistry.readReference(skillId, reference);
        loaded.add(key);
        emit(context, { type: "skill_reference_loaded", skillId, reference });
        return content;
      } catch (error) {
        const code = errorCode(error);
        emit(context, { type: "skill_load_failed", skillId, code });
        return `[error] ${code}`;
      }
    },
  };

  toolRegistry.register(invokeSkill);
  toolRegistry.register(readReference);
}
