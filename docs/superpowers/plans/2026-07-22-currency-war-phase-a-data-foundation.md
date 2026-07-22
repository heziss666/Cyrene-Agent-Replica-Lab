# Currency War Phase A: Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the 4.4 Currency War baseline into the repository and expose a validated, read-only domain catalog that later state, planning, RAG, and Agent tools can use.

**Architecture:** Keep the desktop baseline package as an explicit import source, then commit a reproducible snapshot under `data/currency-war/`. A Zod-validated loader reads the compiled Runtime JSON, while `CurrencyWarCatalog` provides deterministic ID, name, alias, and relationship lookup. This phase deliberately does not create a match-state form, a recommendation engine, or a game-specific chat tool.

**Tech Stack:** TypeScript (NodeNext), Zod 4, Vitest, Node.js `fs/promises`, existing Electron project layout.

## Global Constraints

- Target game data version is exactly `4.4`; every loaded runtime file must declare that version.
- Do not hard-code `C:\Users\123\Desktop` in application code; import source paths are command arguments only.
- `data/currency-war/runtime/4.4` is read-only application data; generated data is changed only by an explicit import command.
- Do not use unverified investment-environment effects as current facts. The initial Runtime may contain an empty environment dataset.
- Do not introduce a graph database, OCR, match-state UI, economic recommendation, or LLM prompt changes in this phase.
- Do not replace existing Cyrene RAG, memory, skills, MCP, scheduler, or generic tool behavior.
- All new production behavior is test-first and all imports must be deterministic.

---

## Planned File Structure

```text
data/currency-war/
├── canonical/v3/                         # Imported evidence-rich source snapshot
├── runtime/4.4/                          # Imported application runtime snapshot
└── manifests/
    └── import-4.4.json                   # Source-independent import provenance

scripts/
└── import-currency-war-baseline.mjs       # Explicit, deterministic baseline importer

src/main/currency-war/
├── data/
│   ├── currency-war-data-types.ts         # Runtime entity and catalog contracts
│   ├── currency-war-data-schemas.ts       # Zod validators for JSON files
│   ├── currency-war-data-paths.ts         # Repository-relative data locations
│   ├── currency-war-runtime-loader.ts     # File loading and cross-file validation
│   └── currency-war-catalog.ts            # Deterministic fact and relationship lookup
└── currency-war-runtime.ts                # Stable facade for later domain modules

src/cli/
└── currency-war-data-check.ts             # Human-readable runtime integrity check

tests/currency-war/data/
├── currency-war-data-schemas.test.ts
├── currency-war-runtime-loader.test.ts
├── currency-war-catalog.test.ts
└── fixtures/
    └── runtime-4.4/                       # Minimal valid and invalid JSON fixtures

tests/scripts/
└── import-currency-war-baseline.test.ts

docs/currency-war/
└── data-contract.md
```

## Task 1: Establish the import command and versioned data snapshot

**Files:**
- Create: `scripts/import-currency-war-baseline.mjs`
- Create: `tests/scripts/import-currency-war-baseline.test.ts`
- Create: `data/currency-war/manifests/import-4.4.json`
- Create: `data/currency-war/canonical/v3/` from the approved baseline package
- Create: `data/currency-war/runtime/4.4/` from the approved baseline package
- Modify: `package.json`
- Modify: `docs/currency-war/data-contract.md`

**Interfaces:**
- Consumes: `node scripts/import-currency-war-baseline.mjs --source <baseline-root> --target <repository-data-root>`.
- Produces: a copied `canonical/v3`, a copied `runtime/4.4`, and `manifests/import-4.4.json` containing source package version, target game version, imported file hashes, and import timestamp.
- Later tasks consume: `data/currency-war/runtime/4.4/*.json` and `data/currency-war/manifests/import-4.4.json`.

- [ ] **Step 1: Write the failing importer integration test**

Create `tests/scripts/import-currency-war-baseline.test.ts`. Use `mkdtemp` to make a source fixture and a target fixture. Seed every file named in `REQUIRED_CANONICAL_FILES` with a minimal valid JSON object, and every file named in `REQUIRED_RUNTIME_FILES` with a minimal valid 4.4 JSON document, then execute the script through `node`.

```ts
it("copies only the canonical and requested runtime snapshot and writes a manifest", () => {
  const result = spawnSync(process.execPath, [scriptPath,
    "--source", sourceRoot, "--target", targetRoot, "--game-version", "4.4",
  ], { encoding: "utf8" });

  expect(result.status).toBe(0);
  expect(readJson(join(targetRoot, "runtime/4.4/characters.json"))).toEqual(sourceCharacters);
  expect(readJson(join(targetRoot, "manifests/import-4.4.json"))).toMatchObject({
    gameVersion: "4.4",
    importedFiles: expect.arrayContaining(["runtime/4.4/characters.json"]),
  });
  expect(existsSync(join(targetRoot, "staging"))).toBe(false);
});

it("refuses a source snapshot whose runtime version does not equal the requested game version", () => {
  writeJson(join(sourceRoot, "runtime/4.4/characters.json"), {
    schema_version: "3.0.0", dataset: "characters", game_version_target: "4.2", records: [],
  });
  const result = spawnSync(process.execPath, [scriptPath,
    "--source", sourceRoot, "--target", targetRoot, "--game-version", "4.4",
  ], { encoding: "utf8" });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("CURRENCY_WAR_IMPORT_VERSION_MISMATCH");
});
```

- [ ] **Step 2: Run the importer test to verify it fails**

Run:

```powershell
npm.cmd test -- --run tests/scripts/import-currency-war-baseline.test.ts
```

Expected: FAIL because `scripts/import-currency-war-baseline.mjs` does not exist.

- [ ] **Step 3: Implement the explicit importer**

Create the script with these exact safeguards:

```js
const REQUIRED_CANONICAL_FILES = [
  "dataset_manifest.json", "sources.json", "characters.json", "bonds.json",
  "equipment.json", "investment_environments.json", "investment_strategies.json",
  "game_rules.json", "version_events.json", "unresolved_questions.json",
];

const REQUIRED_RUNTIME_FILES = [
  "entity_index.json", "characters.json", "bonds.json", "equipment.json",
  "investment_environments.json", "investment_strategies.json", "game_rules.json",
];

function assertRuntimeVersion(document, file, gameVersion) {
  if (document.game_version_target !== gameVersion) {
    throw new Error(`CURRENCY_WAR_IMPORT_VERSION_MISMATCH: ${file}`);
  }
}
```

Use `cp(..., { recursive: true, force: true })` only for the two approved source directories. Parse every copied Runtime JSON before publishing it. Write the manifest only after all validation succeeds. Never delete target files outside `target/canonical/v3`, `target/runtime/<version>`, or `target/manifests/import-<version>.json`.

Add this package script:

```json
"currency-war:import": "node scripts/import-currency-war-baseline.mjs"
```

Use the approved baseline source once:

```powershell
npm.cmd run currency-war:import -- --source "C:\Users\123\Desktop\CURRENCY_WAR_PLAN\currency_war_baseline_v2_1" --target "data\currency-war" --game-version 4.4
```

Document the command and the fact that it deliberately copies Canonical and Runtime snapshots, not Desktop-path references, in `docs/currency-war/data-contract.md`.

- [ ] **Step 4: Run importer tests and inspect the committed snapshot**

Run:

```powershell
npm.cmd test -- --run tests/scripts/import-currency-war-baseline.test.ts
node -e "const x=require('./data/currency-war/runtime/4.4/entity_index.json'); console.log(Object.keys(x.entities).length)"
```

Expected: importer test PASS; the entity index prints `597` for the current approved baseline.

- [ ] **Step 5: Commit the data snapshot and importer**

```powershell
git add package.json scripts/import-currency-war-baseline.mjs tests/scripts/import-currency-war-baseline.test.ts data/currency-war docs/currency-war/data-contract.md
git commit -m "feat: import currency war 4.4 data snapshot"
```

## Task 2: Define runtime data contracts and strict file schemas

**Files:**
- Create: `src/main/currency-war/data/currency-war-data-types.ts`
- Create: `src/main/currency-war/data/currency-war-data-schemas.ts`
- Create: `tests/currency-war/data/currency-war-data-schemas.test.ts`

**Interfaces:**
- Consumes: parsed JSON documents from `data/currency-war/runtime/4.4`.
- Produces: `CurrencyWarEntity`, `CurrencyWarRuntimeDataset`, `CurrencyWarEntityIndex`, `CurrencyWarGameRules`, and `parseCurrencyWarRuntimeFile(value, expectedDataset, gameVersion)`.
- Later tasks consume: these types and parser functions, not `unknown` JSON.

- [ ] **Step 1: Write failing schema tests for accepted and rejected Runtime JSON**

Create a valid character Runtime fixture and assert parsing. Add invalid cases for wrong game version, duplicate entity IDs, and a non-array `records` field. Cross-file entity-index reference validation belongs to Task 3.

```ts
it("accepts a 4.4 character dataset with a stable entity id", () => {
  expect(parseCurrencyWarRuntimeFile(validCharacters, "characters", "4.4")).toMatchObject({
    dataset: "characters", gameVersion: "4.4", records: [{ id: "char-example" }],
  });
});

it("rejects a runtime file from another game version", () => {
  expect(() => parseCurrencyWarRuntimeFile({ ...validCharacters, game_version_target: "4.2" }, "characters", "4.4"))
    .toThrow("CURRENCY_WAR_RUNTIME_VERSION_MISMATCH");
});
```

- [ ] **Step 2: Run the schema test to verify it fails**

Run:

```powershell
npm.cmd test -- --run tests/currency-war/data/currency-war-data-schemas.test.ts
```

Expected: FAIL because the parser module does not exist.

- [ ] **Step 3: Implement focused TypeScript contracts and Zod schemas**

Define only fields Phase A needs for factual lookup and relation traversal:

```ts
export type CurrencyWarEntityType =
  | "characters"
  | "bonds"
  | "equipment"
  | "investment_environments"
  | "investment_strategies";

export interface CurrencyWarEntity {
  id: string;
  names: { zh_cn: string; aliases?: string[] };
  bond_ids?: string[];
  member_ids?: string[];
  related_character_ids?: string[];
  related_bond_ids?: string[];
  effect?: { current_text?: string | null; status?: string; parse_status?: string };
  [key: string]: unknown;
}

export interface CurrencyWarRuntimeDataset {
  schemaVersion: "3.0.0";
  dataset: CurrencyWarEntityType;
  gameVersion: string;
  records: CurrencyWarEntity[];
}
```

Use Zod `.passthrough()` for entity-specific fields that Phase A does not interpret yet, while making wrapper keys, IDs, Chinese display names, entity types, game version, and record arrays strict. Normalize JSON snake_case only once at the parsing boundary. Reject duplicate IDs with `CURRENCY_WAR_RUNTIME_DUPLICATE_ID`.

- [ ] **Step 4: Run the schema test to verify it passes**

Run:

```powershell
npm.cmd test -- --run tests/currency-war/data/currency-war-data-schemas.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the contracts and schemas**

```powershell
git add src/main/currency-war/data/currency-war-data-types.ts src/main/currency-war/data/currency-war-data-schemas.ts tests/currency-war/data/currency-war-data-schemas.test.ts
git commit -m "feat: validate currency war runtime data"
```

## Task 3: Load runtime files independently of the process working directory

**Files:**
- Create: `src/main/currency-war/data/currency-war-data-paths.ts`
- Create: `src/main/currency-war/data/currency-war-runtime-loader.ts`
- Create: `tests/currency-war/data/currency-war-runtime-loader.test.ts`
- Create: `tests/currency-war/data/fixtures/runtime-4.4/characters.json`
- Create: `tests/currency-war/data/fixtures/runtime-4.4/bonds.json`
- Create: `tests/currency-war/data/fixtures/runtime-4.4/equipment.json`
- Create: `tests/currency-war/data/fixtures/runtime-4.4/investment_environments.json`
- Create: `tests/currency-war/data/fixtures/runtime-4.4/investment_strategies.json`
- Create: `tests/currency-war/data/fixtures/runtime-4.4/entity_index.json`
- Create: `tests/currency-war/data/fixtures/runtime-4.4/game_rules.json`

**Interfaces:**
- Consumes: a Runtime directory with the seven required JSON files.
- Produces: `defaultCurrencyWarRuntimeDir()`, `loadCurrencyWarRuntime({ runtimeDir?, gameVersion? })`, and `CurrencyWarRuntimeSnapshot`.
- Later tasks consume: `CurrencyWarRuntimeSnapshot.datasets`, `.entityIndex`, and `.gameRules`.

- [ ] **Step 1: Write failing loader tests**

```ts
it("loads all required runtime files from an explicit fixture directory", async () => {
  const runtime = await loadCurrencyWarRuntime({ runtimeDir: fixtureRuntimeDir, gameVersion: "4.4" });
  expect(runtime.gameVersion).toBe("4.4");
  expect(runtime.datasets.characters.records).toHaveLength(1);
  expect(runtime.entityIndex.entities["char-example"]?.type).toBe("characters");
});

it("does not depend on process.cwd", async () => {
  const original = process.cwd();
  process.chdir(mkdtempSync(join(tmpdir(), "currency-war-cwd-")));
  try {
    await expect(loadCurrencyWarRuntime({ gameVersion: "4.4" })).resolves.toMatchObject({ gameVersion: "4.4" });
  } finally {
    process.chdir(original);
  }
});

it("rejects an index entry that points at an unknown record", async () => {
  await expect(loadCurrencyWarRuntime({ runtimeDir: invalidIndexDir, gameVersion: "4.4" }))
    .rejects.toThrow("CURRENCY_WAR_RUNTIME_INDEX_REFERENCE_MISSING");
});
```

- [ ] **Step 2: Run the loader test to verify it fails**

Run:

```powershell
npm.cmd test -- --run tests/currency-war/data/currency-war-runtime-loader.test.ts
```

Expected: FAIL because the loader modules do not exist.

- [ ] **Step 3: Implement path resolution and cross-file loading**

Resolve the repository data root from the module URL, following the project pattern already used by `src/main/rag/cyrene-knowledge.ts`:

```ts
export function defaultCurrencyWarRuntimeDir(gameVersion = "4.4"): string {
  return fileURLToPath(new URL(`../../../../data/currency-war/runtime/${gameVersion}/`, import.meta.url));
}
```

Load the seven required files with `readFile(..., "utf8")`, parse through Task 2 schemas, and enforce these invariant checks:

- every Runtime JSON declares the requested game version;
- every entity index key exists in exactly one loaded entity dataset;
- every index entry type equals the dataset that owns that entity;
- character `bond_ids`, bond `member_ids`, strategy `related_character_ids`, and strategy `related_bond_ids` may only reference loaded entities when the referenced field is present;
- an empty `investment_environments.records` array is valid;
- incomplete `game_rules` is valid but exposed as incomplete data, not converted to numbers.

Use errors beginning with `CURRENCY_WAR_RUNTIME_` so later UI and Agent layers can classify them safely.

- [ ] **Step 4: Run loader tests and the existing runtime tests**

Run:

```powershell
npm.cmd test -- --run tests/currency-war/data/currency-war-runtime-loader.test.ts tests/runtime/agent-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the loader**

```powershell
git add src/main/currency-war/data/currency-war-data-paths.ts src/main/currency-war/data/currency-war-runtime-loader.ts tests/currency-war/data
git commit -m "feat: load currency war runtime snapshot"
```

## Task 4: Build a deterministic entity and relationship catalog

**Files:**
- Create: `src/main/currency-war/data/currency-war-catalog.ts`
- Create: `src/main/currency-war/currency-war-runtime.ts`
- Create: `tests/currency-war/data/currency-war-catalog.test.ts`

**Interfaces:**
- Consumes: `CurrencyWarRuntimeSnapshot` from Task 3.
- Produces: `createCurrencyWarCatalog(snapshot)`, `CurrencyWarCatalog.getById(id)`, `.findByName(query)`, `.getRelated(id)`, and `createCurrencyWarRuntime(options?)`.
- Later tasks consume: the runtime facade instead of loading JSON separately.

- [ ] **Step 1: Write failing catalog tests**

```ts
it("finds an entity by stable id and protects its stored data from mutation", () => {
  const entity = catalog.getById("char-example");
  expect(entity?.names.zh_cn).toBe("示例角色");
  if (entity) entity.names.zh_cn = "mutated";
  expect(catalog.getById("char-example")?.names.zh_cn).toBe("示例角色");
});

it("finds exact Chinese names and aliases before normalized partial names", () => {
  expect(catalog.findByName("示例角色").map((item) => item.id)).toEqual(["char-example"]);
  expect(catalog.findByName("示例").map((item) => item.id)).toContain("char-example");
});

it("traverses character-to-bond and bond-to-member relations without using an LLM", () => {
  expect(catalog.getRelated("char-example").map((item) => item.id)).toContain("bond-example");
  expect(catalog.getRelated("bond-example").map((item) => item.id)).toContain("char-example");
});
```

- [ ] **Step 2: Run the catalog test to verify it fails**

Run:

```powershell
npm.cmd test -- --run tests/currency-war/data/currency-war-catalog.test.ts
```

Expected: FAIL because the catalog module does not exist.

- [ ] **Step 3: Implement catalog lookup and the stable runtime facade**

Implement the following contract:

```ts
export interface CurrencyWarCatalog {
  getById(id: string): CurrencyWarEntity | undefined;
  findByName(query: string, options?: { limit?: number }): CurrencyWarEntity[];
  getRelated(id: string): CurrencyWarEntity[];
  list(type: CurrencyWarEntityType): CurrencyWarEntity[];
}

export interface CurrencyWarRuntime {
  readonly gameVersion: string;
  readonly catalog: CurrencyWarCatalog;
  readonly dataHealth: {
    investmentEnvironmentsAvailable: number;
    gameRulesComplete: boolean;
  };
}
```

For name matching, normalize Unicode with `NFKC`, trim whitespace, use exact `names.zh_cn` and aliases first, then use safe case-insensitive substring matching. Sort ties by entity ID. Return deep clones or `structuredClone` values so renderer, future tools, and Agent code cannot mutate catalog state.

`dataHealth.gameRulesComplete` must only be true when refresh cost, at least one interest rule, at least one population level, and at least one shop-odds record are present. This makes current incompleteness explicit instead of hidden.

- [ ] **Step 4: Run catalog tests**

Run:

```powershell
npm.cmd test -- --run tests/currency-war/data/currency-war-catalog.test.ts tests/currency-war/data/currency-war-runtime-loader.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit catalog and runtime facade**

```powershell
git add src/main/currency-war/data/currency-war-catalog.ts src/main/currency-war/currency-war-runtime.ts tests/currency-war/data/currency-war-catalog.test.ts
git commit -m "feat: add currency war entity catalog"
```

## Task 5: Add a developer-facing integrity check and document the contract

**Files:**
- Create: `src/cli/currency-war-data-check.ts`
- Create: `tests/currency-war/data/currency-war-data-check.test.ts`
- Modify: `package.json`
- Modify: `docs/currency-war/data-contract.md`

**Interfaces:**
- Consumes: `createCurrencyWarRuntime()` from Task 4.
- Produces: `npm run currency-war:data-check`, exit code `0` for a valid snapshot, and a concise JSON-free terminal report.
- Later tasks consume: documented data guarantees and the check command in CI/manual verification.

- [ ] **Step 1: Write the failing CLI test**

```ts
it("prints the runtime version, entity counts, environment availability, and game-rule health", () => {
  const tsxCliPath = fileURLToPath(new URL("../../../node_modules/tsx/dist/cli.mjs", import.meta.url));
  const cliPath = fileURLToPath(new URL("../../../src/cli/currency-war-data-check.ts", import.meta.url));
  const result = spawnSync(process.execPath, [tsxCliPath, cliPath, "--runtime-dir", fixtureRuntimeDir], { encoding: "utf8" });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Currency War runtime: 4.4");
  expect(result.stdout).toContain("characters: 1");
  expect(result.stdout).toContain("game rules complete: false");
});

it("exits non-zero and names the validation code for an invalid runtime directory", () => {
  const tsxCliPath = fileURLToPath(new URL("../../../node_modules/tsx/dist/cli.mjs", import.meta.url));
  const cliPath = fileURLToPath(new URL("../../../src/cli/currency-war-data-check.ts", import.meta.url));
  const result = spawnSync(process.execPath, [tsxCliPath, cliPath, "--runtime-dir", invalidRuntimeDir], { encoding: "utf8" });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("CURRENCY_WAR_RUNTIME_");
});
```

- [ ] **Step 2: Run the CLI test to verify it fails**

Run:

```powershell
npm.cmd test -- --run tests/currency-war/data/currency-war-data-check.test.ts
```

Expected: FAIL because the CLI does not exist.

- [ ] **Step 3: Implement the data check CLI and package script**

Support one optional argument:

```text
--runtime-dir <directory>
```

Without that argument, load the repository snapshot. Print this stable report shape:

```text
Currency War runtime: 4.4
characters: 72
bonds: 33
equipment: 158
investment strategies: 334
investment environments available: 0
game rules complete: false
```

On an error, print only the error code/message to stderr and set `process.exitCode = 1`.

Add:

```json
"currency-war:data-check": "tsx src/cli/currency-war-data-check.ts"
```

Expand `docs/currency-war/data-contract.md` with: Runtime's read-only rule, import command, expected 4.4 entity counts, why empty environments are valid, and the rule that incomplete game rules forbid later economic recommendations.

- [ ] **Step 4: Verify the full Phase A deliverable**

Run:

```powershell
npm.cmd test -- --run tests/currency-war tests/scripts/import-currency-war-baseline.test.ts
npm.cmd run currency-war:data-check
npm.cmd run typecheck
npm.cmd run build
```

Expected: all tests pass; the data check reports 4.4, 72 characters, 33 bonds, 158 equipment, 334 strategies, 0 available environments, and incomplete game rules; typecheck and build pass.

- [ ] **Step 5: Commit the CLI and documentation**

```powershell
git add src/cli/currency-war-data-check.ts tests/currency-war/data/currency-war-data-check.test.ts package.json docs/currency-war/data-contract.md
git commit -m "feat: add currency war data integrity check"
```

## Plan Self-Review

- Spec coverage: Tasks 1-5 implement Phase A only: source-independent import, three-layer data boundaries, strict Runtime validation, deterministic entity lookup, relation traversal, data-health visibility, tests, and operational documentation.
- Intentionally deferred: manual MatchState input, Electron game workspace, Agent tools, prompts, Skills, RAG guide ingestion, recommendation scoring, economic planner, screenshot recognition, and graph database. These belong to later implementation plans.
- Placeholder scan: no tasks depend on undefined types or unnamed validation behavior. All later interfaces are defined by earlier tasks.
- Type consistency: Task 2 defines the parsing contracts used by Task 3; Task 3 defines `CurrencyWarRuntimeSnapshot` used by Task 4; Task 4 defines the runtime facade consumed by Task 5.
