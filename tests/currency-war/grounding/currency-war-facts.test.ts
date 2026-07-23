import { beforeAll, describe, expect, it } from "vitest";
import { createCurrencyWarRuntime, type CurrencyWarRuntime } from "../../../src/main/currency-war/currency-war-runtime.js";
import { loadCurrencyWarRuntime } from "../../../src/main/currency-war/data/currency-war-runtime-loader.js";
import { createCurrencyWarFactService } from "../../../src/main/currency-war/grounding/currency-war-facts.js";

let runtime: CurrencyWarRuntime;

beforeAll(async () => {
  runtime = createCurrencyWarRuntime(await loadCurrencyWarRuntime());
});

describe("CurrencyWarFactService", () => {
  it("returns exact character facts instead of inferred bonds or roles", () => {
    const facts = createCurrencyWarFactService(runtime);

    const result = facts.lookup(["阿格莱雅", "爻光", "乱破", "藿藿"]);

    expect(result.records).toMatchObject([
      {
        type: "characters",
        name: "阿格莱雅",
        data: { cost: 1, field: "前台", roles: ["输出"], bonds: ["昼之半神", "能量"] },
      },
      {
        type: "characters",
        name: "爻光",
        data: { cost: 1, field: "前后台", roles: ["辅助"], bonds: ["仙舟", "欢愉"] },
      },
      {
        type: "characters",
        name: "乱破",
        data: { cost: 1, field: "前台", roles: ["输出"], bonds: ["击破", "巡海游侠"] },
      },
      {
        type: "characters",
        name: "藿藿",
        data: {
          cost: 1,
          field: "前后台",
          roles: ["治疗", "辅助"],
          bonds: ["仙舟", "治疗", "能量"],
        },
      },
    ]);
  });

  it("preserves null as locally unrecorded information", () => {
    const facts = createCurrencyWarFactService(runtime);

    const result = facts.lookup(["长线利好"]);

    expect(result.records).toMatchObject([{
      type: "investment_environments",
      name: "长线利好",
      data: { effect: null },
    }]);
    expect(facts.format(result.records)).toContain("本地资料未记录");
  });

  it("matches known entities mentioned in free text in textual order", () => {
    const facts = createCurrencyWarFactService(runtime);

    expect(facts.matchText("乱破和藿藿怎么选，装备有幸运星").map((item) => item.name))
      .toEqual(["乱破", "藿藿", "幸运星"]);
  });

  it("reports unknown names without inventing records", () => {
    const facts = createCurrencyWarFactService(runtime);

    expect(facts.lookup(["不存在的角色"])).toEqual({
      gameVersion: "4.4",
      records: [],
      unknownNames: ["不存在的角色"],
    });
  });
});
