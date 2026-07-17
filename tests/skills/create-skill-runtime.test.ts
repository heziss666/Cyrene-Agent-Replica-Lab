import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createSkillRuntime } from "../../src/main/skills/create-skill-runtime.js";

describe("createSkillRuntime", () => {
  it("initializes one registry from fixed roots and tool ids", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-runtime-"));
    const builtinRoot = join(root, "builtin");
    const skillRoot = join(builtinRoot, "tutor");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), `---
name: Tutor
description: Teach the project.
tools: [search_knowledge]
---
Teach.
`, "utf8");

    const runtime = await createSkillRuntime({
      builtinRoot,
      userRoot: join(root, "user"),
      settingsPath: join(root, "settings.json"),
      toolIds: ["search_knowledge"],
    });

    expect(runtime.registry.list()).toEqual([
      expect.objectContaining({ id: "tutor", enabled: true, available: true }),
    ]);
  });
});
