import { describe, expect, it } from "vitest";
import { parseCurrencyWarRuntimeFile } from "../../../src/main/currency-war/data/currency-war-data-schemas.js";

const validCharacters = {
  schema_version: "3.0.0",
  dataset: "characters",
  game_version_target: "4.4",
  generated_from: "canonical/v3",
  records: [{
    id: "char-example",
    names: { zh_cn: "Example Character", aliases: ["Example"] },
    bond_ids: ["bond-example"],
  }],
};

describe("parseCurrencyWarRuntimeFile", () => {
  it("accepts a 4.4 character dataset with a stable entity id", () => {
    expect(parseCurrencyWarRuntimeFile(validCharacters, "characters", "4.4")).toMatchObject({
      schemaVersion: "3.0.0",
      dataset: "characters",
      gameVersion: "4.4",
      records: [{ id: "char-example", names: { zh_cn: "Example Character" } }],
    });
  });

  it("rejects a runtime file from another game version", () => {
    expect(() => parseCurrencyWarRuntimeFile(
      { ...validCharacters, game_version_target: "4.2" },
      "characters",
      "4.4",
    )).toThrow("CURRENCY_WAR_RUNTIME_VERSION_MISMATCH");
  });

  it("rejects duplicate entity ids", () => {
    expect(() => parseCurrencyWarRuntimeFile({
      ...validCharacters,
      records: [validCharacters.records[0], validCharacters.records[0]],
    }, "characters", "4.4")).toThrow("CURRENCY_WAR_RUNTIME_DUPLICATE_ID");
  });

  it("rejects a dataset with a non-array records field", () => {
    expect(() => parseCurrencyWarRuntimeFile(
      { ...validCharacters, records: {} },
      "characters",
      "4.4",
    )).toThrow("CURRENCY_WAR_RUNTIME_SCHEMA_INVALID");
  });

  it("rejects a file whose dataset does not match its expected filename", () => {
    expect(() => parseCurrencyWarRuntimeFile(
      { ...validCharacters, dataset: "equipment" },
      "characters",
      "4.4",
    )).toThrow("CURRENCY_WAR_RUNTIME_DATASET_MISMATCH");
  });
});
