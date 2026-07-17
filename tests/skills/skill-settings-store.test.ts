import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createSkillSettingsStore } from "../../src/main/skills/skill-settings-store.js";

describe("createSkillSettingsStore", () => {
  it("saves and loads enabled states", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-settings-"));
    const store = createSkillSettingsStore(join(root, "skills-settings.json"));

    await store.save({ alpha: false, beta: true });

    await expect(store.load()).resolves.toEqual({ alpha: false, beta: true });
    expect(JSON.parse(await readFile(join(root, "skills-settings.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      enabledById: { alpha: false, beta: true },
    });
  });

  it("quarantines a corrupt file and returns empty settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-settings-"));
    const filePath = join(root, "skills-settings.json");
    await writeFile(filePath, "not-json", "utf8");
    const store = createSkillSettingsStore(filePath, { now: () => 123 });

    await expect(store.load()).resolves.toEqual({});
    expect(await readdir(root)).toContain("skills-settings.json.corrupt-123");
  });
});
