import type { SkillEntry } from "./skill-types.js";

export type SkillCommandResult =
  | { kind: "none"; text: string }
  | { kind: "activated"; skillId: string; text: string }
  | { kind: "error"; code: "SKILL_TASK_REQUIRED" };

export function parseSkillCommand(
  text: string,
  skills: SkillEntry[],
): SkillCommandResult {
  const match = text.match(/^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/);
  if (!match) return { kind: "none", text };
  const skillId = match[1]!;
  const skill = skills.find((entry) =>
    entry.id === skillId && entry.enabled && entry.available,
  );
  if (!skill) return { kind: "none", text };
  const task = (match[2] ?? "").trim();
  if (!task) return { kind: "error", code: "SKILL_TASK_REQUIRED" };
  return { kind: "activated", skillId, text: task };
}
