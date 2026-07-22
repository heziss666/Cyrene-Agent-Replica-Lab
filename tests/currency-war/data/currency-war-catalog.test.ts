import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createCurrencyWarCatalog } from "../../../src/main/currency-war/data/currency-war-catalog.js";
import { createCurrencyWarRuntime } from "../../../src/main/currency-war/currency-war-runtime.js";
import { loadCurrencyWarRuntime } from "../../../src/main/currency-war/data/currency-war-runtime-loader.js";

const fixtureRuntimeDir = fileURLToPath(new URL("fixtures/runtime-4.4/", import.meta.url));

describe("CurrencyWarCatalog", () => {
  it("finds entities by ID without exposing mutable snapshot data", async () => {
    const catalog = createCurrencyWarCatalog(await loadCurrencyWarRuntime({ runtimeDir: fixtureRuntimeDir }));

    const character = catalog.getById("char-example");
    expect(character?.names.zh_cn).toBe("测试角色");
    if (character) character.names.zh_cn = "被篡改";

    expect(catalog.getById("char-example")?.names.zh_cn).toBe("测试角色");
  });

  it("finds names by exact match, alias, and normalized partial text", async () => {
    const catalog = createCurrencyWarCatalog(await loadCurrencyWarRuntime({ runtimeDir: fixtureRuntimeDir }));

    expect(catalog.findByName("测试角色").map((item) => item.id)).toEqual(["char-example"]);
    expect(catalog.findByName("小测").map((item) => item.id)).toEqual(["char-example"]);
    expect(catalog.findByName(" 测试 ").map((item) => item.id)).toEqual(["char-example"]);
  });

  it("traverses character and bond relations in both directions", async () => {
    const catalog = createCurrencyWarCatalog(await loadCurrencyWarRuntime({ runtimeDir: fixtureRuntimeDir }));

    expect(catalog.getRelated("char-example").map((item) => item.id)).toEqual(["bond-example"]);
    expect(catalog.getRelated("bond-example").map((item) => item.id)).toEqual(["char-example"]);
  });

  it("reports the availability of data needed for later strategy features", async () => {
    const runtime = createCurrencyWarRuntime(await loadCurrencyWarRuntime({ runtimeDir: fixtureRuntimeDir }));

    expect(runtime.dataHealth.investmentEnvironmentsAvailable).toBe(false);
    expect(runtime.dataHealth.gameRulesComplete).toBe(false);
  });
});
