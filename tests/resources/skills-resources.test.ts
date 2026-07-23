import { access, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
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
    expect(body).toContain("4.4–4.7");
    expect(body).not.toContain("只处理 4.4 版本");
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
    expect(evidence).toContain("cycle-confirmed");
    expect(evidence).toContain("lineup-synthesis");
    expect(evidence).not.toContain("4.4-synthesis");
    expect(evidence).toContain("needs-validation");
    expect(evidence).not.toContain("https://");
  });

  it("loads the Himeko Departure Train skill with focused references", async () => {
    const userData = await mkdtemp(join(tmpdir(), "currency-war-himeko-skill-"));
    const runtime = await createSkillRuntime({
      builtinRoot: defaultBuiltinSkillsRoot(),
      userRoot: join(userData, "skills"),
      settingsPath: join(userData, "settings.json"),
      toolIds: ["search_knowledge"],
    });

    const entry = runtime.registry.get("currency-war-himeko-departure-train");
    expect(entry).toMatchObject({
      name: "Currency War Himeko Departure Train",
      enabled: true,
      available: true,
      requiredTools: [],
    });
    expect(entry?.references.map(({ name }) => name)).toEqual([
      "equipment.md",
      "evidence.md",
      "lineup-core.md",
      "operations.md",
    ]);

    const body = await runtime.registry.readBody("currency-war-himeko-departure-train");
    const lineup = await runtime.registry.readReference(
      "currency-war-himeko-departure-train",
      "lineup-core.md",
    );
    const operations = await runtime.registry.readReference(
      "currency-war-himeko-departure-train",
      "operations.md",
    );
    const equipment = await runtime.registry.readReference(
      "currency-war-himeko-departure-train",
      "equipment.md",
    );
    const evidence = await runtime.registry.readReference(
      "currency-war-himeko-departure-train",
      "evidence.md",
    );

    expect(body).toContain("姬子·启行—列车同行");
    expect(body).toContain("本轮唯一主任务");
    expect(body).toContain("最多 5 个");
    expect(body).toContain("停止条件");
    expect(body).toContain("4.4–4.7");
    expect(body).not.toContain("https://");
    expect(lineup).toContain("领航员");
    expect(lineup).toContain("4 列车同行");
    expect(lineup).toContain("量子同频");
    expect(operations).toContain("7 级");
    expect(operations).toContain("三星姬子");
    expect(equipment).toContain("复制装备");
    expect(evidence).toContain("cycle-confirmed");
    expect(evidence).not.toContain("https://");
  });

  it("loads the Phainon Counter Armor skill with focused references", async () => {
    const userData = await mkdtemp(join(tmpdir(), "currency-war-phainon-skill-"));
    const runtime = await createSkillRuntime({
      builtinRoot: defaultBuiltinSkillsRoot(),
      userRoot: join(userData, "skills"),
      settingsPath: join(userData, "settings.json"),
      toolIds: ["search_knowledge"],
    });

    const entry = runtime.registry.get("currency-war-phainon-counter-armor");
    expect(entry).toMatchObject({
      name: "Currency War Phainon Counter Armor",
      enabled: true,
      available: true,
      requiredTools: [],
    });
    expect(entry?.references.map(({ name }) => name)).toEqual([
      "equipment.md",
      "evidence.md",
      "lineup-core.md",
      "operations.md",
    ]);

    const body = await runtime.registry.readBody("currency-war-phainon-counter-armor");
    const lineup = await runtime.registry.readReference(
      "currency-war-phainon-counter-armor",
      "lineup-core.md",
    );
    const operations = await runtime.registry.readReference(
      "currency-war-phainon-counter-armor",
      "operations.md",
    );
    const equipment = await runtime.registry.readReference(
      "currency-war-phainon-counter-armor",
      "equipment.md",
    );
    const evidence = await runtime.registry.readReference(
      "currency-war-phainon-counter-armor",
      "evidence.md",
    );

    expect(body).toContain("白厄—以牙还牙甲");
    expect(body).toContain("本轮唯一主任务");
    expect(body).toContain("最多 5 个");
    expect(body).toContain("4.4–4.7");
    expect(body).not.toContain("https://");
    expect(lineup).toContain("直伤白厄");
    expect(lineup).toContain("反甲白厄");
    expect(lineup).toContain("护盾");
    expect(operations).toContain("7 级");
    expect(operations).toContain("退回直伤");
    expect(equipment).toContain("以牙还牙甲");
    expect(equipment).toContain("三件");
    expect(evidence).toContain("cycle-confirmed");
    expect(evidence).not.toContain("https://");
  });

  it("does not retain superseded root currency war documents", async () => {
    const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
    await expect(access(join(projectRoot, "CURRENCY_WAR_4_4_DOT_LINEUP_SKILL.md")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(projectRoot, "CURRENCY_WAR_GAMEPLAY_RULES_FOR_AGENT.md")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(
      projectRoot,
      "CURRENCY_WAR_4_4_HIMEKO_DEPARTURE_LINEUP_SKILL.md",
    ))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(
      projectRoot,
      "CURRENCY_WAR_4_4_PHAINON_COUNTER_LINEUP_SKILL.md",
    ))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
