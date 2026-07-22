import { describe, expect, it } from "vitest";
import { parseCurrencyWarSimpleFile } from "../../../src/main/currency-war/data/currency-war-data-schemas.js";

const source = { name: "test", url: "https://example.test", updated_at: "2026-07-21" };
const validCharacters = {
  version: "4.4",
  source,
  characters: [{
    name: "测试角色",
    aliases: ["小测"],
    cost: 3,
    field: "前台",
    roles: ["输出"],
    bonds: ["测试羁绊"],
    empowerment: { front: null, back: null, stars: {} },
    advisor: false,
  }],
};

describe("parseCurrencyWarSimpleFile", () => {
  it("accepts a compact 4.4 character document keyed by names", () => {
    expect(parseCurrencyWarSimpleFile(validCharacters, "characters", "4.4")).toMatchObject({
      version: "4.4",
      characters: [{ name: "测试角色", bonds: ["测试羁绊"] }],
    });
  });

  it("rejects a document from another game version", () => {
    expect(() => parseCurrencyWarSimpleFile(
      { ...validCharacters, version: "4.2" },
      "characters",
      "4.4",
    )).toThrow("CURRENCY_WAR_SIMPLE_VERSION_MISMATCH");
  });

  it("rejects duplicate names instead of relying on opaque IDs", () => {
    expect(() => parseCurrencyWarSimpleFile({
      ...validCharacters,
      characters: [validCharacters.characters[0], validCharacters.characters[0]],
    }, "characters", "4.4")).toThrow("CURRENCY_WAR_SIMPLE_DUPLICATE_NAME");
  });

  it("rejects a record that retains a forbidden opaque id", () => {
    expect(() => parseCurrencyWarSimpleFile({
      ...validCharacters,
      characters: [{ ...validCharacters.characters[0], id: "char-a3ee58e525" }],
    }, "characters", "4.4")).toThrow("CURRENCY_WAR_SIMPLE_FORBIDDEN_FIELD");
  });

  it("rejects a document whose expected collection is missing", () => {
    expect(() => parseCurrencyWarSimpleFile(
      { version: "4.4", source, records: [] },
      "characters",
      "4.4",
    )).toThrow("CURRENCY_WAR_SIMPLE_SCHEMA_INVALID");
  });
});
