import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { scanSkillRoots } from "../../src/main/skills/skill-scanner.js";

async function createRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cyrene-skills-"));
}

async function writeSkill(
  root: string,
  id: string,
  options: { description?: string; body?: string; defaultEnabled?: boolean } = {},
): Promise<string> {
  const skillRoot = join(root, id);
  await mkdir(skillRoot, { recursive: true });
  await writeFile(join(skillRoot, "SKILL.md"), `---
name: ${id}
description: ${options.description ?? `${id} description`}
defaultEnabled: ${options.defaultEnabled ?? true}
tools: [echo]
---
${options.body ?? `${id} body`}
`, "utf8");
  return skillRoot;
}

describe("scanSkillRoots", () => {
  it("lets a user skill replace a builtin skill with the same id", async () => {
    const root = await createRoot();
    const builtinRoot = join(root, "builtin");
    const userRoot = join(root, "user");
    await writeSkill(builtinRoot, "shared", { body: "builtin body" });
    await writeSkill(userRoot, "shared", { body: "user body" });

    const result = await scanSkillRoots({ builtinRoot, userRoot });

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({ id: "shared", source: "user" });
    expect(result.skills[0]?.body).toBe("user body");
  });

  it("builds a reference whitelist and reports invalid directories without aborting", async () => {
    const root = await createRoot();
    const builtinRoot = join(root, "builtin");
    const userRoot = join(root, "user");
    const skillRoot = await writeSkill(builtinRoot, "valid-skill");
    await mkdir(join(skillRoot, "references"), { recursive: true });
    await writeFile(join(skillRoot, "references", "guide.md"), "safe guide", "utf8");
    await writeSkill(builtinRoot, "INVALID_ID");

    const result = await scanSkillRoots({ builtinRoot, userRoot });

    expect(result.skills[0]?.references).toEqual([
      expect.objectContaining({ name: "guide.md", sizeBytes: 10 }),
    ]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SKILL_ID_INVALID" }),
    ]));
  });

  it("rejects reference symlinks that escape the skill root", async () => {
    const root = await createRoot();
    const builtinRoot = join(root, "builtin");
    const userRoot = join(root, "user");
    const skillRoot = await writeSkill(builtinRoot, "safe-skill");
    const references = join(skillRoot, "references");
    await mkdir(references, { recursive: true });
    const outside = join(root, "outside");
    await mkdir(outside);
    await symlink(outside, join(references, "escape"), "junction");

    const result = await scanSkillRoots({ builtinRoot, userRoot });

    expect(result.skills[0]?.references).toEqual([]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SKILL_REFERENCE_SYMLINK" }),
    ]));
  });
});
