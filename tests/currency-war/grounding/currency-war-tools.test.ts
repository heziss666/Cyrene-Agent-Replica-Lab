import { beforeAll, describe, expect, it } from "vitest";
import { createCurrencyWarRuntime, type CurrencyWarRuntime } from "../../../src/main/currency-war/currency-war-runtime.js";
import { loadCurrencyWarRuntime } from "../../../src/main/currency-war/data/currency-war-runtime-loader.js";
import { createCurrencyWarFactService } from "../../../src/main/currency-war/grounding/currency-war-facts.js";
import { registerCurrencyWarTools } from "../../../src/main/currency-war/grounding/currency-war-tools.js";
import { ToolRegistry } from "../../../src/main/tools/tool-registry.js";

let runtime: CurrencyWarRuntime;

beforeAll(async () => {
  runtime = createCurrencyWarRuntime(await loadCurrencyWarRuntime());
});

describe("lookup_currency_war_data", () => {
  it("registers an exact structured-data lookup schema", () => {
    const registry = new ToolRegistry();
    registerCurrencyWarTools(registry, createCurrencyWarFactService(runtime));

    const tool = registry.getById("lookup_currency_war_data");

    expect(tool?.parameters.required).toEqual(["names"]);
    expect(tool?.parameters.properties.names).toMatchObject({
      type: "array",
      items: { type: "string" },
    });
  });

  it("returns local facts and preserves unknown fields", async () => {
    const registry = new ToolRegistry();
    registerCurrencyWarTools(registry, createCurrencyWarFactService(runtime));

    const output = await registry.getById("lookup_currency_war_data")?.execute({
      names: ["阿格莱雅", "长线利好"],
    });

    expect(output).toContain("data_version: 4.4");
    expect(output).toContain("阿格莱雅");
    expect(output).toContain("昼之半神");
    expect(output).toContain("长线利好");
    expect(output).toContain("本地资料未记录");
    expect(output).toContain("不得根据模型记忆补全");
  });

  it("rejects missing and oversized name lists", async () => {
    const registry = new ToolRegistry();
    registerCurrencyWarTools(registry, createCurrencyWarFactService(runtime));
    const tool = registry.getById("lookup_currency_war_data");

    await expect(tool?.execute({ names: [] })).resolves.toBe("[error] CURRENCY_WAR_NAMES_REQUIRED");
    await expect(tool?.execute({
      names: Array.from({ length: 21 }, (_, index) => `名称${index}`),
    })).resolves.toBe("[error] CURRENCY_WAR_TOO_MANY_NAMES");
  });
});
