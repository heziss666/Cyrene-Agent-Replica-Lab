import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { defaultCurrencyWarRuntimeDir, loadCurrencyWarRuntime } from "../../../src/main/currency-war/data/currency-war-runtime-loader.js";

const fixtureRuntimeDir = fileURLToPath(new URL("./fixtures/runtime-4.4/", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
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
  it("loads the five compact data files from an explicit directory", async () => {
    const runtime = await loadCurrencyWarRuntime({ runtimeDir: fixtureRuntimeDir, gameVersion: "4.4" });

    expect(runtime.gameVersion).toBe("4.4");
    expect(runtime.characters).toHaveLength(1);
    expect(runtime.characters[0]?.name).toBe("测试角色");
    expect(runtime.investmentEnvironments).toHaveLength(1);
  });

  it("resolves the compact repository snapshot independently from process.cwd", async () => {
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

  it("rejects a character that references a missing bond name", async () => {
    const runtimeDir = copyFixture();
    const charactersPath = join(runtimeDir, "characters.json");
    const characters = JSON.parse(readFileSync(charactersPath, "utf8")) as { characters: Array<{ bonds: string[] }> };
    characters.characters[0]!.bonds = ["不存在的羁绊"];
    writeJson(charactersPath, characters);

    await expect(loadCurrencyWarRuntime({ runtimeDir, gameVersion: "4.4" }))
      .rejects.toThrow("CURRENCY_WAR_SIMPLE_RELATION_REFERENCE_MISSING");
  });
});
