import matter from "gray-matter";
import type { ParsedSkillDocument } from "./skill-types.js";

export const MAX_SKILL_DESCRIPTION_CHARS = 500;
export const MAX_SKILL_BODY_CHARS = 16_000;

function fail(code: string): never {
  throw new Error(code);
}

function nonEmptyString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(code);
  return value.trim();
}

export function parseSkillDocument(content: string): ParsedSkillDocument {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    fail("SKILL_FRONTMATTER_INVALID");
  }

  const name = nonEmptyString(parsed.data.name, "SKILL_NAME_REQUIRED");
  const description = nonEmptyString(
    parsed.data.description,
    "SKILL_DESCRIPTION_REQUIRED",
  );
  if (description.length > MAX_SKILL_DESCRIPTION_CHARS) {
    fail("SKILL_DESCRIPTION_TOO_LARGE");
  }

  const version = parsed.data.version;
  if (version !== undefined && typeof version !== "string") {
    fail("SKILL_VERSION_INVALID");
  }

  const tools = parsed.data.tools ?? [];
  if (!Array.isArray(tools) || tools.some((tool) => typeof tool !== "string" || !tool.trim())) {
    fail("SKILL_TOOLS_INVALID");
  }
  const requiredTools = tools.map((tool: string) => tool.trim());
  if (new Set(requiredTools).size !== requiredTools.length) {
    fail("SKILL_TOOLS_DUPLICATED");
  }

  const defaultEnabled = parsed.data.defaultEnabled ?? true;
  if (typeof defaultEnabled !== "boolean") {
    fail("SKILL_DEFAULT_ENABLED_INVALID");
  }

  const body = parsed.content.trim();
  if (body.length > MAX_SKILL_BODY_CHARS) fail("SKILL_BODY_TOO_LARGE");

  return {
    name,
    description,
    ...(version === undefined ? {} : { version }),
    requiredTools,
    defaultEnabled,
    body,
  };
}
