import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createCurrencyWarCatalog } from "../../../src/main/currency-war/data/currency-war-catalog.js";
import { createCurrencyWarRuntime } from "../../../src/main/currency-war/currency-war-runtime.js";
import { loadCurrencyWarRuntime } from "../../../src/main/currency-war/data/currency-war-runtime-loader.js";

const fixtureRuntimeDir = fileURLToPath(new URL("fixtures/runtime-4.4/", import.meta.url));

describe("CurrencyWarCatalog", () => {
  it("finds an entity by its human-readable name without exposing mutable data", async () => {
    const catalog = createCurrencyWarCatalog(await loadCurrencyWarRuntime({ runtimeDir: fixtureRuntimeDir }));

    const character = catalog.getByName("测试角色");
    expect(character?.name).toBe("测试角色");
    if (character) character.name = "被篡改";

    expect(catalog.getByName("测试角色")?.name).toBe("测试角色");
  });

  it("finds names by exact match, alias, and normalized partial text", async () => {
    const catalog = createCurrencyWarCatalog(await loadCurrencyWarRuntime({ runtimeDir: fixtureRuntimeDir }));

    expect(catalog.findByName("测试角色").map((item) => item.name)).toEqual(["测试角色"]);
    expect(catalog.findByName("小测").map((item) => item.name)).toEqual(["测试角色"]);
    expect(catalog.findByName(" 测试 ").map((item) => item.name)).toEqual([
      "测试角色", "测试羁绊", "测试装备", "测试环境", "测试策略",
    ]);
  });

  it("traverses character and bond relations by Chinese names", async () => {
    const catalog = createCurrencyWarCatalog(await loadCurrencyWarRuntime({ runtimeDir: fixtureRuntimeDir }));

    expect(catalog.getRelated("测试角色").map((item) => item.name)).toEqual(["测试羁绊"]);
    expect(catalog.getRelated("测试羁绊").map((item) => item.name)).toEqual(["测试角色"]);
  });

  it("reports compact-data availability without pretending that economic rules exist", async () => {
    const runtime = createCurrencyWarRuntime(await loadCurrencyWarRuntime({ runtimeDir: fixtureRuntimeDir }));

    expect(runtime.dataHealth.investmentEnvironmentsAvailable).toBe(true);
    expect(runtime.dataHealth.economyRulesAvailable).toBe(false);
  });
});
