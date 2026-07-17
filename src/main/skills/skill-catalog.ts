import type { SkillEntry } from "./skill-types.js";

const MAX_CATALOG_SKILLS = 100;

export function buildSkillCatalog(entries: SkillEntry[]): string {
  const lines = entries
    .filter((skill) => skill.enabled && skill.available)
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, MAX_CATALOG_SKILLS)
    .map((skill) => {
      const tools = skill.requiredTools.length > 0
        ? ` [tools: ${skill.requiredTools.join(", ")}]`
        : "";
      return `- ${skill.id}: ${skill.description}${tools}`;
    });

  if (lines.length === 0) return "";
  return [
    "## Available Skills",
    "When a skill description matches the current task, call invoke_skill before acting.",
    ...lines,
  ].join("\n");
}
