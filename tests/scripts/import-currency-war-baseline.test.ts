import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const REQUIRED_CANONICAL_FILES = [
  "dataset_manifest.json", "sources.json", "characters.json", "bonds.json",
  "equipment.json", "investment_environments.json", "investment_strategies.json",
  "game_rules.json", "version_events.json", "unresolved_questions.json",
];

const REQUIRED_RUNTIME_FILES = [
  "entity_index.json", "characters.json", "bonds.json", "equipment.json",
  "investment_environments.json", "investment_strategies.json", "game_rules.json",
];

const scriptPath = resolve("scripts/import-currency-war-baseline.mjs");
const temporaryPaths: string[] = [];

function makeTemporaryDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  temporaryPaths.push(path);
  return path;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function seedSourceSnapshot(sourceRoot: string): Record<string, unknown> {
  for (const file of REQUIRED_CANONICAL_FILES) {
    writeJson(join(sourceRoot, "canonical", "v3", file), { dataset: file });
  }

  const runtimeDocuments: Record<string, unknown> = {};
  for (const file of REQUIRED_RUNTIME_FILES) {
    const document = {
      schema_version: "3.0.0",
      dataset: file.replace(".json", ""),
      game_version_target: "4.4",
      records: [],
    };
    runtimeDocuments[file] = document;
    writeJson(join(sourceRoot, "runtime", "4.4", file), document);
  }

  return runtimeDocuments;
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("import-currency-war-baseline", () => {
  it("copies only the canonical and requested runtime snapshot and writes a manifest", () => {
    const sourceRoot = makeTemporaryDirectory("currency-war-source-");
    const targetRoot = makeTemporaryDirectory("currency-war-target-");
    const runtimeDocuments = seedSourceSnapshot(sourceRoot);

    const result = spawnSync(process.execPath, [
      scriptPath,
      "--source", sourceRoot,
      "--target", targetRoot,
      "--game-version", "4.4",
    ], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(readJson(join(targetRoot, "runtime/4.4/characters.json"))).toEqual(
      runtimeDocuments["characters.json"],
    );
    expect(readJson(join(targetRoot, "manifests/import-4.4.json"))).toMatchObject({
      gameVersion: "4.4",
      importedFiles: expect.arrayContaining(["runtime/4.4/characters.json"]),
    });
    expect(existsSync(join(targetRoot, "staging"))).toBe(false);
  });

  it("refuses a source snapshot whose runtime version does not equal the requested game version", () => {
    const sourceRoot = makeTemporaryDirectory("currency-war-source-");
    const targetRoot = makeTemporaryDirectory("currency-war-target-");
    seedSourceSnapshot(sourceRoot);
    writeJson(join(sourceRoot, "runtime/4.4/characters.json"), {
      schema_version: "3.0.0",
      dataset: "characters",
      game_version_target: "4.2",
      records: [],
    });

    const result = spawnSync(process.execPath, [
      scriptPath,
      "--source", sourceRoot,
      "--target", targetRoot,
      "--game-version", "4.4",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CURRENCY_WAR_IMPORT_VERSION_MISMATCH");
  });

  it("refuses a copied runtime JSON document that cannot be parsed", () => {
    const sourceRoot = makeTemporaryDirectory("currency-war-source-");
    const targetRoot = makeTemporaryDirectory("currency-war-target-");
    seedSourceSnapshot(sourceRoot);
    const invalidRuntimePath = join(sourceRoot, "runtime/4.4/additional.json");
    writeFileSync(invalidRuntimePath, "{");

    const result = spawnSync(process.execPath, [
      scriptPath,
      "--source", sourceRoot,
      "--target", targetRoot,
      "--game-version", "4.4",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
  });
});
