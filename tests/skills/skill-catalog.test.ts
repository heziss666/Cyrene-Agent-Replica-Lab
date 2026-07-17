import { describe, expect, it } from "vitest";
import { buildSkillCatalog } from "../../src/main/skills/skill-catalog.js";
import type { SkillEntry } from "../../src/main/skills/skill-types.js";

function entry(id: string, overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    id,
    name: id,
    description: `${id} description`,
    requiredTools: ["echo"],
    source: "builtin",
    rootPath: "root",
    bodyPath: "body",
    references: [],
    defaultEnabled: true,
    enabled: true,
    available: true,
    unavailableReasons: [],
    ...overrides,
  };
}

describe("buildSkillCatalog", () => {
  it("includes only enabled and available skills without paths or body", () => {
    const catalog = buildSkillCatalog([
      entry("visible"),
      entry("disabled", { enabled: false }),
      entry("unavailable", { available: false }),
    ]);

    expect(catalog).toContain("- visible: visible description [tools: echo]");
    expect(catalog).not.toContain("disabled description");
    expect(catalog).not.toContain("unavailable description");
    expect(catalog).not.toContain("root");
  });

  it("limits the prompt catalog to 100 skills", () => {
    const catalog = buildSkillCatalog(
      Array.from({ length: 101 }, (_, index) => entry(`skill-${String(index).padStart(3, "0")}`)),
    );
    expect(catalog).toContain("skill-099");
    expect(catalog).not.toContain("skill-100");
  });
});
