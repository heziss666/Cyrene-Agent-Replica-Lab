import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultCurrencyWarRuntimeDir,
  loadCurrencyWarRuntime,
} from "../../../src/main/currency-war/data/currency-war-runtime-loader.js";

const fixtureRuntimeDir = fileURLToPath(new URL("./fixtures/runtime-4.4/", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function copyFixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "currency-war-runtime-"));
  temporaryDirectories.push(directory);
  const runtimeDir = join(directory, "runtime-4.4");
  cpSync(fixtureRuntimeDir, runtimeDir, { recursive: true });
  return runtimeDir;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("loadCurrencyWarRuntime", () => {
  it("loads all required runtime files from an explicit fixture directory", async () => {
    const runtime = await loadCurrencyWarRuntime({ runtimeDir: fixtureRuntimeDir, gameVersion: "4.4" });

    expect(runtime.gameVersion).toBe("4.4");
    expect(runtime.datasets.characters.records).toHaveLength(1);
    expect(runtime.entityIndex.entities["char-example"]?.type).toBe("characters");
    expect(runtime.datasets.investment_environments.records).toEqual([]);
  });

  it("resolves the repository runtime directory independently from process.cwd", async () => {
    const originalDirectory = process.cwd();
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "currency-war-cwd-"));
    temporaryDirectories.push(temporaryDirectory);
    process.chdir(temporaryDirectory);
    try {
      await expect(loadCurrencyWarRuntime({ gameVersion: "4.4" })).resolves.toMatchObject({ gameVersion: "4.4" });
      expect(defaultCurrencyWarRuntimeDir("4.4")).toContain("data");
    } finally {
      process.chdir(originalDirectory);
    }
  });

  it("rejects an index entry that points at an unknown record", async () => {
    const runtimeDir = copyFixture();
    const indexPath = join(runtimeDir, "entity_index.json");
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as { entities: Record<string, unknown> };
    index.entities["char-missing"] = { type: "characters", name_zh: "Missing" };
    writeJson(indexPath, index);

    await expect(loadCurrencyWarRuntime({ runtimeDir, gameVersion: "4.4" }))
      .rejects.toThrow("CURRENCY_WAR_RUNTIME_INDEX_REFERENCE_MISSING");
  });

  it("rejects a character that references a missing bond", async () => {
    const runtimeDir = copyFixture();
    const charactersPath = join(runtimeDir, "characters.json");
    const characters = JSON.parse(readFileSync(charactersPath, "utf8")) as { records: Array<{ bond_ids: string[] }> };
    characters.records[0]!.bond_ids = ["bond-missing"];
    writeJson(charactersPath, characters);

    await expect(loadCurrencyWarRuntime({ runtimeDir, gameVersion: "4.4" }))
      .rejects.toThrow("CURRENCY_WAR_RUNTIME_RELATION_REFERENCE_MISSING");
  });
});
