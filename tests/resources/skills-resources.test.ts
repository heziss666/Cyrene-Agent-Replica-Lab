import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  createSkillRuntime,
  defaultBuiltinSkillsRoot,
} from "../../src/main/skills/create-skill-runtime.js";

describe("builtin skill resources", () => {
  it("loads the tutor by default and keeps original voice opt-in", async () => {
    const userData = await mkdtemp(join(tmpdir(), "builtin-skills-"));
    const runtime = await createSkillRuntime({
      builtinRoot: defaultBuiltinSkillsRoot(),
      userRoot: join(userData, "skills"),
      settingsPath: join(userData, "settings.json"),
      toolIds: ["search_knowledge"],
    });

    expect(runtime.registry.get("agent-learning-tutor")).toMatchObject({
      enabled: true,
      available: true,
      requiredTools: ["search_knowledge"],
    });
    expect(runtime.registry.get("cyrene-original-voice")).toMatchObject({
      enabled: false,
      available: true,
    });
    expect(runtime.registry.get("cyrene-original-voice")?.references).toHaveLength(9);
    await expect(runtime.registry.readBody("cyrene-original-voice"))
      .rejects.toThrow("SKILL_DISABLED");
  });
});
