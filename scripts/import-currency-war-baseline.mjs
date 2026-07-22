import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const REQUIRED_CANONICAL_FILES = [
  "dataset_manifest.json", "sources.json", "characters.json", "bonds.json",
  "equipment.json", "investment_environments.json", "investment_strategies.json",
  "game_rules.json", "version_events.json", "unresolved_questions.json",
];

const REQUIRED_SIMPLE_FILES = [
  "characters.json", "bonds.json", "equipment.json",
  "investment_environments.json", "investment_strategies.json",
];

function parseArguments(argumentsList) {
  const values = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const option = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!option?.startsWith("--") || !value || values[option]) {
      throw new Error("Usage: node scripts/import-currency-war-baseline.mjs --source <baseline-root> --target <repository-data-root> --game-version <version>");
    }
    values[option] = value;
  }

  if (!values["--source"] || !values["--target"] || !values["--game-version"]) {
    throw new Error("Usage: node scripts/import-currency-war-baseline.mjs --source <baseline-root> --target <repository-data-root> --game-version <version>");
  }

  return {
    sourceRoot: values["--source"],
    targetRoot: values["--target"],
    gameVersion: values["--game-version"],
  };
}

function assertSimpleVersion(document, file, gameVersion) {
  if (document.version !== gameVersion) {
    throw new Error(`CURRENCY_WAR_IMPORT_VERSION_MISMATCH: ${file}`);
  }
}

async function assertRequiredFiles(directory, files) {
  for (const file of files) {
    const path = join(directory, file);
    try {
      if (!(await stat(path)).isFile()) {
        throw new Error("not a file");
      }
    } catch {
      throw new Error(`CURRENCY_WAR_IMPORT_REQUIRED_FILE_MISSING: ${path}`);
    }
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function hashFile(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function validateSimpleJson(directory, gameVersion) {
  await Promise.all(REQUIRED_SIMPLE_FILES.map(async (file) => {
    const document = await readJson(join(directory, file));
    assertSimpleVersion(document, file, gameVersion);
  }));
}

async function importBaseline({ sourceRoot, targetRoot, gameVersion }) {
  const sourceCanonicalDirectory = join(sourceRoot, "canonical", "v3");
  const sourceSimpleDirectory = join(sourceRoot, "simple", gameVersion);
  const targetCanonicalDirectory = join(targetRoot, "canonical", "v3");
  const targetRuntimeDirectory = join(targetRoot, "runtime", gameVersion);

  await assertRequiredFiles(sourceCanonicalDirectory, REQUIRED_CANONICAL_FILES);
  await assertRequiredFiles(sourceSimpleDirectory, REQUIRED_SIMPLE_FILES);

  await cp(sourceCanonicalDirectory, targetCanonicalDirectory, { recursive: true, force: true });
  await rm(targetRuntimeDirectory, { recursive: true, force: true });
  await mkdir(targetRuntimeDirectory, { recursive: true });
  await Promise.all(REQUIRED_SIMPLE_FILES.map((file) => cp(
    join(sourceSimpleDirectory, file),
    join(targetRuntimeDirectory, file),
    { force: true },
  )));

  await validateSimpleJson(targetRuntimeDirectory, gameVersion);
  const datasetManifest = await readJson(join(targetCanonicalDirectory, "dataset_manifest.json"));

  const importedFiles = [
    ...REQUIRED_CANONICAL_FILES.map((file) => `canonical/v3/${file}`),
    ...REQUIRED_SIMPLE_FILES.map((file) => `runtime/${gameVersion}/${file}`),
  ];
  const importedFileHashes = Object.fromEntries(await Promise.all(importedFiles.map(async (file) => [
    file,
    await hashFile(join(targetRoot, file)),
  ])));
  const manifest = {
    sourcePackageVersion: datasetManifest.dataset_version ?? "unknown",
    gameVersion,
    importedAt: new Date().toISOString(),
    importedFiles,
    importedFileHashes,
  };

  await mkdir(join(targetRoot, "manifests"), { recursive: true });
  await writeFile(
    join(targetRoot, "manifests", `import-${gameVersion}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

}

async function main() {
  await importBaseline(parseArguments(process.argv.slice(2)));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
