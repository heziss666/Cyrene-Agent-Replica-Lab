import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { SkillRegistry } from "../../src/main/skills/skill-registry.js";
import { createSkillSettingsStore } from "../../src/main/skills/skill-settings-store.js";

async function fixture(): Promise<{ registry: SkillRegistry; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "skill-registry-"));
  const builtinRoot = join(root, "builtin");
  const skillRoot = join(builtinRoot, "tutor");
  await mkdir(join(skillRoot, "references"), { recursive: true });
  await writeFile(join(skillRoot, "SKILL.md"), `---
name: Tutor
description: Teach the project.
tools: [search_knowledge]
---
Tutor body
`, "utf8");
  await writeFile(join(skillRoot, "references", "guide.md"), "Guide body", "utf8");
  const registry = new SkillRegistry({
    builtinRoot,
    userRoot: join(root, "user"),
    settingsStore: createSkillSettingsStore(join(root, "settings.json")),
    getToolIds: () => ["search_knowledge"],
  });
  return { registry, root };
}

describe("SkillRegistry", () => {
  it("initializes entries and reads whitelisted content", async () => {
    const { registry } = await fixture();
    await registry.initialize();

    expect(registry.list()).toEqual([
      expect.objectContaining({ id: "tutor", enabled: true, available: true }),
    ]);
    await expect(registry.readBody("tutor")).resolves.toBe("Tutor body");
    await expect(registry.readReference("tutor", "guide.md")).resolves.toBe("Guide body");
    await expect(registry.readReference("tutor", "../secret.md")).rejects.toThrow(
      "SKILL_REFERENCE_NOT_FOUND",
    );
  });

  it("persists enabled state and reapplies it after reload", async () => {
    const { registry } = await fixture();
    await registry.initialize();

    await registry.setEnabled("tutor", false);
    await registry.reload();

    expect(registry.get("tutor")?.enabled).toBe(false);
  });

  it("marks a skill unavailable when a required tool is missing", async () => {
    const { registry } = await fixture();
    registry.setToolIdsProvider(() => []);
    await registry.initialize();

    expect(registry.get("tutor")).toMatchObject({
      available: false,
      unavailableReasons: ["Missing tool: search_knowledge"],
    });
  });

  it("rejects same-size reference changes made after scanning", async () => {
    const { registry, root } = await fixture();
    await registry.initialize();
    await writeFile(
      join(root, "builtin", "tutor", "references", "guide.md"),
      "Changed!!!",
      "utf8",
    );

    await expect(registry.readReference("tutor", "guide.md"))
      .rejects.toThrow("SKILL_CHANGED_SINCE_SCAN");
  });

  it("keeps the in-memory enabled state when persistence fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-registry-save-"));
    const skillRoot = join(root, "builtin", "tutor");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), `---
name: Tutor
description: Teach.
---
Body
`, "utf8");
    const registry = new SkillRegistry({
      builtinRoot: join(root, "builtin"),
      userRoot: join(root, "user"),
      settingsStore: {
        load: async () => ({}),
        save: async () => { throw new Error("disk full"); },
      },
    });
    await registry.initialize();

    await expect(registry.setEnabled("tutor", false)).rejects.toThrow("disk full");
    expect(registry.get("tutor")?.enabled).toBe(true);
  });
});
