import { describe, expect, it } from "vitest";
import { skillStatusLabel, sortSkillItems } from "../../src/renderer/chat/skills-view-model.js";
import type { SkillListItem } from "../../src/shared/skill-api-types.js";

function item(id: string, overrides: Partial<SkillListItem> = {}): SkillListItem {
  return {
    id,
    name: id,
    description: `${id} description`,
    requiredTools: [],
    source: "builtin",
    references: [],
    defaultEnabled: true,
    enabled: true,
    available: true,
    unavailableReasons: [],
    ...overrides,
  };
}

describe("skills view model", () => {
  it("sorts available skills before unavailable skills by id", () => {
    expect(sortSkillItems([
      item("zeta", { available: false }),
      item("beta"),
      item("alpha"),
    ]).map((skill) => skill.id)).toEqual(["alpha", "beta", "zeta"]);
  });

  it("describes disabled and unavailable states", () => {
    expect(skillStatusLabel(item("a", { enabled: false }))).toBe("Disabled");
    expect(skillStatusLabel(item("a", {
      available: false,
      unavailableReasons: ["Missing tool: echo"],
    }))).toBe("Unavailable: Missing tool: echo");
  });
});
