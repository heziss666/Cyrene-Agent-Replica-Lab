import type { SkillListItem } from "../../shared/skill-api-types.js";

export function sortSkillItems(items: readonly SkillListItem[]): SkillListItem[] {
  return [...items].sort((left, right) => {
    if (left.available !== right.available) return left.available ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
}

export function skillStatusLabel(skill: SkillListItem): string {
  if (!skill.available) {
    return `Unavailable: ${skill.unavailableReasons.join("; ") || "validation failed"}`;
  }
  return skill.enabled ? "Enabled" : "Disabled";
}
