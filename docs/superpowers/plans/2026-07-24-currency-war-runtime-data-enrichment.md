# Currency War Runtime Data Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, source-backed pipeline that fills the Currency War 4.4 character, bond, equipment, and investment-environment details and regenerates validated runtime data.

**Architecture:** A small MediaWiki client retrieves character and bond revisions in batches and retrieves equipment and environment records through Semantic MediaWiki. Focused parsers normalize source markup into rich canonical records; a projector produces the lightweight runtime files consumed by the Agent.

**Tech Stack:** Node.js 22, ECMAScript modules, MediaWiki API, Semantic MediaWiki API, TypeScript, Zod, Vitest.

## Global Constraints

- Official 4.4 announcements take precedence over BWIKI and other third-party sources.
- Never use an LLM to generate, rewrite, or infer game facts.
- Preserve source wording and slash-separated skill scaling values.
- Character recommended equipment is one merged, deduplicated list, not separate front/back lists.
- Failed or partial downloads must not overwrite complete local datasets.
- Unknown facts remain explicitly unresolved instead of being guessed.

---

### Task 1: Deterministic Wiki parsers

**Files:**
- Create: `scripts/currency-war-data/wiki-normalize.mjs`
- Create: `scripts/currency-war-data/wiki-template-parser.mjs`
- Create: `scripts/currency-war-data/character-parser.mjs`
- Create: `scripts/currency-war-data/bond-parser.mjs`
- Test: `tests/scripts/currency-war-data-parsers.test.ts`

**Interfaces:**
- Produces: `parseCharacterPage(wikitext)`, `parseBondPage(wikitext)`, `stripWikiMarkup(text)`.
- Character output contains `name`, `cost`, `field`, `roles`, `bonds`, `empowerment`, and `recommended_equipment`.
- Bond output contains `name`, `category`, `base_effect`, `effects`, and `special_rules`.

- [ ] Add failing fixtures for a front-only character, a split front/back character, a shared front/back character, and a tiered bond.
- [ ] Run `npm test -- --run tests/scripts/currency-war-data-parsers.test.ts` and verify missing-module failures.
- [ ] Implement balanced-brace template parsing so nested skill templates do not split outer parameters.
- [ ] Normalize `<span>`, `<br>`, wiki links, effect templates, color templates, and image-stat labels without changing numbers.
- [ ] Parse skill groups, star-stat columns, merged recommended equipment, bond tiers, and special rules.
- [ ] Re-run the parser tests and require all cases to pass.
- [ ] Commit parser code and tests.

### Task 2: Source client and structured dataset parsers

**Files:**
- Create: `scripts/currency-war-data/mediawiki-client.mjs`
- Create: `scripts/currency-war-data/semantic-record-parser.mjs`
- Test: `tests/scripts/currency-war-data-source-client.test.ts`

**Interfaces:**
- Produces: `fetchPageRevisions(titles, options)`, `askSemantic(query, options)`, `parseEquipmentResult(result)`, and `parseEnvironmentResult(result)`.
- Network functions accept an injected `fetch` for offline tests.

- [ ] Add failing tests for batched revision responses, semantic equipment/environment responses, retryable HTTP 429/567/5xx, and a missing page.
- [ ] Run the source-client test and verify failures.
- [ ] Implement timeout, bounded retries, delay, explicit user agent, and batch size 40.
- [ ] Implement semantic normalization of equipment stats, effects, recipes, tags, recommended characters, and environment effects.
- [ ] Re-run the source-client tests and require all cases to pass.
- [ ] Commit the source client and tests.

### Task 3: Runtime schema and canonical projection

**Files:**
- Modify: `src/main/currency-war/data/currency-war-data-types.ts`
- Modify: `src/main/currency-war/data/currency-war-data-schemas.ts`
- Create: `scripts/currency-war-data/runtime-projector.mjs`
- Create: `scripts/currency-war-data/data-validator.mjs`
- Test: `tests/scripts/currency-war-data-projector.test.ts`
- Modify: `tests/currency-war/data/currency-war-data-schemas.test.ts`

**Interfaces:**
- Produces: `projectRuntime(canonicalDatasets)` and `validateEnrichedData(datasets)`.
- Validation returns `{ errors, warnings, metrics }` and never silently drops records.

- [ ] Add failing tests for rich empowerment objects, numeric bond tiers, merged equipment stats, cross-reference failures, and valid normal nulls.
- [ ] Run projector and schema tests and verify failures.
- [ ] Define typed character skill/group/star structures and bond base/special fields.
- [ ] Implement canonical-to-runtime projection and cross-dataset validation.
- [ ] Require character field/empowerment consistency, bidirectional bond membership, valid equipment recipes, and unique names.
- [ ] Re-run tests and require all cases to pass.
- [ ] Commit schemas, projector, validator, and tests.

### Task 4: Online enrichment command

**Files:**
- Create: `scripts/enrich-currency-war-data.mjs`
- Modify: `package.json`
- Create: `data/currency-war/DATA_LICENSE.md`
- Test: `tests/scripts/enrich-currency-war-data.test.ts`

**Interfaces:**
- Adds command: `npm run currency-war:enrich-data`.
- Supports `--dry-run` and `--offline-snapshot`.
- Writes only after every fetched dataset parses and validates.

- [ ] Add failing orchestration tests using injected fixture responses and a temporary output directory.
- [ ] Run the enrichment test and verify failure.
- [ ] Implement download, source precedence, merge, canonical update, runtime projection, atomic writes, and report generation.
- [ ] Add BWIKI attribution and CC BY-NC-SA 4.0 data-license notice.
- [ ] Re-run orchestration tests and require all cases to pass.
- [ ] Commit the command, package script, tests, and license notice.

### Task 5: Populate and audit the 4.4 datasets

**Files:**
- Modify: `data/currency-war/canonical/v3/characters.json`
- Modify: `data/currency-war/canonical/v3/bonds.json`
- Modify: `data/currency-war/canonical/v3/equipment.json`
- Modify: `data/currency-war/canonical/v3/investment_environments.json`
- Modify: `data/currency-war/canonical/v3/investment_strategies.json`
- Modify: `data/currency-war/canonical/v3/sources.json`
- Modify: `data/currency-war/canonical/v3/dataset_manifest.json`
- Modify: `data/currency-war/runtime/4.4/characters.json`
- Modify: `data/currency-war/runtime/4.4/bonds.json`
- Modify: `data/currency-war/runtime/4.4/equipment.json`
- Modify: `data/currency-war/runtime/4.4/investment_environments.json`
- Modify: `data/currency-war/runtime/4.4/investment_strategies.json`
- Modify: `data/currency-war/manifests/import-4.4.json`
- Create: `data/currency-war/reports/4.4-enrichment-report.json`

**Interfaces:**
- Consumes the Task 4 command.
- Produces the complete checked-in 4.4 data snapshot and audit report.

- [ ] Run `npm run currency-war:enrich-data -- --dry-run` and inspect counts and unresolved records.
- [ ] Resolve parser defects surfaced by the complete source set; do not hand-invent missing values.
- [ ] Run the write mode once all required source pages parse.
- [ ] Run the data validator and verify zero errors.
- [ ] Inspect representative records: 吉尔伽美什, 星期日, 白厄, 巡海游侠, 能量, 以牙还牙甲, 长线利好.
- [ ] Commit populated datasets and the audit report.

### Task 6: Agent integration and final verification

**Files:**
- Modify: `src/main/currency-war/grounding/currency-war-facts.ts`
- Modify: `tests/currency-war/grounding/currency-war-facts.test.ts`

**Interfaces:**
- The existing `lookup_currency_war_data` tool returns the new rich fields without changing its public arguments.

- [ ] Add tests proving lookup output contains character empowerment, star stats, bond effects, and equipment stats.
- [ ] Fix existing mojibake fallback text while touching the formatter.
- [ ] Run `npm test -- --run tests/currency-war tests/scripts`.
- [ ] Run `npm test -- --run`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check` and inspect the final data report.
- [ ] Commit integration and verification fixes.
