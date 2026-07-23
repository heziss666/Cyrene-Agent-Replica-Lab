import { beforeAll, describe, expect, it, vi } from "vitest";
import { createCurrencyWarRuntime, type CurrencyWarRuntime } from "../../../src/main/currency-war/currency-war-runtime.js";
import { loadCurrencyWarRuntime } from "../../../src/main/currency-war/data/currency-war-runtime-loader.js";
import { createCurrencyWarFactService } from "../../../src/main/currency-war/grounding/currency-war-facts.js";
import { createCurrencyWarGroundingBuilder } from "../../../src/main/currency-war/grounding/currency-war-grounding.js";

let runtime: CurrencyWarRuntime;

beforeAll(async () => {
  runtime = createCurrencyWarRuntime(await loadCurrencyWarRuntime());
});

function fakeSkills() {
  return {
    get: vi.fn((id: string) => id === "currency-war-phainon-counter-armor"
      ? {
          id,
          enabled: true,
          available: true,
          references: [{ name: "lineup-core.md" }, { name: "equipment.md" }],
        }
      : undefined),
    readBody: vi.fn(async () => "白厄反甲主体说明：使用以牙还牙甲。"),
    readReference: vi.fn(async (_id: string, name: string) =>
      name === "lineup-core.md"
        ? "白厄是3费前台输出，羁绊为救世主。"
        : "幸运星与量产型装甲用于合成以牙还牙甲。"),
  };
}

describe("CurrencyWarGroundingBuilder", () => {
  it("combines input facts, routed skill content, references, and referenced facts", async () => {
    const skills = fakeSkills();
    const builder = createCurrencyWarGroundingBuilder({
      facts: createCurrencyWarFactService(runtime),
      skills,
    });

    const pack = await builder.build("阿格莱雅和爻光在备战席，我想玩白厄反伤");

    expect(pack).toContain("## 货币战争本轮证据包");
    expect(pack).toContain("数据版本：4.4");
    expect(pack).toContain("阿格莱雅");
    expect(pack).toContain("昼之半神");
    expect(pack).toContain("爻光");
    expect(pack).toContain("currency-war-phainon-counter-armor");
    expect(pack).toContain("白厄是3费前台输出");
    expect(pack).toContain("幸运星");
    expect(skills.readBody).toHaveBeenCalledWith("currency-war-phainon-counter-armor");
    expect(skills.readReference).toHaveBeenCalledTimes(2);
  });

  it("does not load a disabled or unavailable skill", async () => {
    const skills = fakeSkills();
    skills.get.mockReturnValue({
      id: "currency-war-phainon-counter-armor",
      enabled: false,
      available: true,
      references: [],
    });
    const builder = createCurrencyWarGroundingBuilder({
      facts: createCurrencyWarFactService(runtime),
      skills,
    });

    const pack = await builder.build("我想玩白厄反甲");

    expect(pack).toContain("SKILL_DISABLED");
    expect(skills.readBody).not.toHaveBeenCalled();
  });

  it("returns an empty string for text with no game facts or lineup route", async () => {
    const builder = createCurrencyWarGroundingBuilder({
      facts: createCurrencyWarFactService(runtime),
      skills: fakeSkills(),
    });

    await expect(builder.build("请解释 TypeScript interface")).resolves.toBe("");
  });
});
