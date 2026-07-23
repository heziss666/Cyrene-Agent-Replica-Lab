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

  it("loads the Kafka Hysilens DoT skill with focused references", async () => {
    const userData = await mkdtemp(join(tmpdir(), "currency-war-dot-skill-"));
    const runtime = await createSkillRuntime({
      builtinRoot: defaultBuiltinSkillsRoot(),
      userRoot: join(userData, "skills"),
      settingsPath: join(userData, "settings.json"),
      toolIds: ["search_knowledge"],
    });

    expect(runtime.registry.get("currency-war-kafka-hysilens-dot")).toMatchObject({
      name: "Currency War Kafka Hysilens DoT",
      enabled: true,
      available: true,
      requiredTools: [],
    });
    expect(runtime.registry.get("currency-war-kafka-hysilens-dot")?.references
      .map((reference) => reference.name)).toEqual([
      "equipment.md",
      "evidence.md",
      "lineup-core.md",
      "operations.md",
    ]);

    const body = await runtime.registry.readBody("currency-war-kafka-hysilens-dot");
    expect(body).toContain("卡芙卡—海瑟音");
    expect(body).toContain("本轮唯一主任务");
    expect(body).toContain("最多 5 个");
    expect(body).toContain("停止条件");
    expect(body).not.toContain("https://");

    const lineup = await runtime.registry.readReference(
      "currency-war-kafka-hysilens-dot",
      "lineup-core.md",
    );
    expect(lineup).toContain("卡芙卡");
    expect(lineup).toContain("海瑟音");
    expect(lineup).toContain("黑天鹅");
    expect(lineup).toContain("椒丘");
    expect(lineup).toContain("6 持续伤害");

    const operations = await runtime.registry.readReference(
      "currency-war-kafka-hysilens-dot",
      "operations.md",
    );
    expect(operations).toContain("第一位面");
    expect(operations).toContain("第二位面");
    expect(operations).toContain("第三位面");
    expect(operations).toContain("止损");

    const evidence = await runtime.registry.readReference(
      "currency-war-kafka-hysilens-dot",
      "evidence.md",
    );
    expect(evidence).toContain("4.4-confirmed");
    expect(evidence).toContain("needs-validation");
    expect(evidence).not.toContain("https://");
  });
});
