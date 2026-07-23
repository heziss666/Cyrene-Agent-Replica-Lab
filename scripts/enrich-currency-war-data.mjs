import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBondPage } from "./currency-war-data/bond-parser.mjs";
import { parseCharacterPage } from "./currency-war-data/character-parser.mjs";
import { validateEnrichedData } from "./currency-war-data/data-validator.mjs";
import { buildEnrichedDatasets } from "./currency-war-data/enrichment-pipeline.mjs";
import { askSemantic, fetchPageRevisions } from "./currency-war-data/mediawiki-client.mjs";
import { parseEnvironmentResult, parseEquipmentResult } from "./currency-war-data/semantic-record-parser.mjs";

const GAME_VERSION = "4.4";
const ADVISORS = new Set(["银狼", "姬子", "佩拉", "停云", "桑博", "加拉赫", "青雀", "刃"]);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DIR = join(ROOT, "data", "currency-war", "runtime", GAME_VERSION);
const CANONICAL_DIR = join(ROOT, "data", "currency-war", "canonical", "v3");
const REPORT_PATH = join(ROOT, "data", "currency-war", "reports", "4.4-enrichment-report.json");

export async function enrichCurrencyWarData({ dryRun = false } = {}) {
  const runtimeDocuments = {
    characters: await readJson(join(RUNTIME_DIR, "characters.json")),
    bonds: await readJson(join(RUNTIME_DIR, "bonds.json")),
    equipment: await readJson(join(RUNTIME_DIR, "equipment.json")),
    environments: await readJson(join(RUNTIME_DIR, "investment_environments.json")),
    strategies: await readJson(join(RUNTIME_DIR, "investment_strategies.json")),
  };
  const existing = {
    characters: runtimeDocuments.characters.characters,
    bonds: runtimeDocuments.bonds.bonds,
    equipment: runtimeDocuments.equipment.equipment,
    environments: runtimeDocuments.environments.environments,
    strategies: runtimeDocuments.strategies.strategies,
  };

  const characterTitles = existing.characters.map((item) => `货币战争/${item.name}`);
  const bondTitles = existing.bonds.map((item) => `货币战争/羁绊/${item.name}`);
  const networkOptions = {
    batchSize: 10,
    delayMs: 2_000,
    retryDelayMs: 5_000,
    maxAttempts: 8,
  };
  const characterPages = await fetchPageRevisions(characterTitles, networkOptions);
  const bondPages = await fetchPageRevisions(bondTitles, networkOptions);
  const equipmentResults = await askSemantic(
    "[[分类:货币战争/装备]]|?名称|?类型|?标签|?基础属性|?描述|?获取方式|?获取途径|?实装版本|?适配角色|limit=1000",
    networkOptions,
  );
  const environmentResults = await askSemantic(
    "[[分类:投资环境]]|?名称|?效果|?角色|?装备|limit=1000",
    networkOptions,
  );

  const characterDetails = new Map(existing.characters.map((item) => {
    const page = characterPages.get(`货币战争/${item.name}`);
    if (!page) throw new Error(`CURRENCY_WAR_ENRICHMENT_CHARACTER_PAGE_MISSING:${item.name}`);
    return [item.name, parseCharacterPage(page.content)];
  }));
  const bondDetails = new Map(existing.bonds.map((item) => {
    const page = bondPages.get(`货币战争/羁绊/${item.name}`);
    if (!page) throw new Error(`CURRENCY_WAR_ENRICHMENT_BOND_PAGE_MISSING:${item.name}`);
    return [item.name, parseBondPage(page.content)];
  }));
  const allEquipment = new Map(Object.values(equipmentResults).map((result) => {
    const parsed = parseEquipmentResult(result);
    return [parsed.name, parsed];
  }));
  const sourceExceptions = [];
  for (const item of existing.equipment) {
    if (!allEquipment.has(item.name)) {
      allEquipment.set(item.name, {
        ...item,
        tags: item.tags ?? [],
        recommended_for: item.recommended_for ?? [],
        source_status: "not_in_equipment_catalog",
      });
      sourceExceptions.push(`EQUIPMENT_NOT_IN_CATALOG:${item.name}`);
    }
  }
  const allEnvironments = new Map(Object.values(environmentResults).map((result) => {
    const parsed = parseEnvironmentResult(result);
    return [parsed.name, parsed];
  }));

  const datasets = buildEnrichedDatasets({
    existing,
    characterDetails,
    bondDetails,
    equipmentDetails: allEquipment,
    environmentDetails: allEnvironments,
    advisors: ADVISORS,
  });
  const validation = validateEnrichedData(datasets);
  if (validation.errors.length > 0) {
    throw new Error(`CURRENCY_WAR_ENRICHMENT_INVALID\n${validation.errors.join("\n")}`);
  }

  const capturedAt = new Date().toISOString();
  const report = {
    game_version: GAME_VERSION,
    captured_at: capturedAt,
    dry_run: dryRun,
    metrics: validation.metrics,
    warnings: [...validation.warnings, ...sourceExceptions],
    source_pages: {
      characters: characterPages.size,
      bonds: bondPages.size,
      equipment: allEquipment.size,
      investment_environments: allEnvironments.size,
    },
    completeness: {
      character_front_groups: datasets.characters.filter((item) => item.empowerment.front).length,
      character_back_groups: datasets.characters.filter((item) => item.empowerment.back).length,
      character_star_tables: datasets.characters.filter((item) => Object.keys(item.empowerment.stars).length > 0).length,
      bond_effect_tables: datasets.bonds.filter((item) => Object.keys(item.effects).length > 0).length,
      equipment_stats: datasets.equipment.filter((item) => Object.keys(item.stats).length > 0).length,
      environment_effects: datasets.environments.filter((item) => item.effect).length,
    },
  };
  if (dryRun) return { datasets, report };

  const outputs = runtimeOutputs(runtimeDocuments, datasets);
  const canonical = await updateCanonical(datasets, characterPages, bondPages, capturedAt);
  for (const [path, value] of [...outputs, ...canonical]) await writeJsonAtomic(path, value);
  await writeJsonAtomic(REPORT_PATH, report);
  await updateImportManifest(capturedAt);
  return { datasets, report };
}

function runtimeOutputs(documents, datasets) {
  return [
    [join(RUNTIME_DIR, "characters.json"), { ...documents.characters, characters: datasets.characters }],
    [join(RUNTIME_DIR, "bonds.json"), { ...documents.bonds, bonds: datasets.bonds }],
    [join(RUNTIME_DIR, "equipment.json"), { ...documents.equipment, equipment: datasets.equipment }],
    [join(RUNTIME_DIR, "investment_environments.json"), { ...documents.environments, environments: datasets.environments }],
    [join(RUNTIME_DIR, "investment_strategies.json"), { ...documents.strategies, strategies: datasets.strategies }],
  ];
}

async function updateCanonical(datasets, characterPages, bondPages, capturedAt) {
  const charactersDocument = await readJson(join(CANONICAL_DIR, "characters.json"));
  const bondsDocument = await readJson(join(CANONICAL_DIR, "bonds.json"));
  const equipmentDocument = await readJson(join(CANONICAL_DIR, "equipment.json"));
  const environmentsDocument = await readJson(join(CANONICAL_DIR, "investment_environments.json"));
  const manifest = await readJson(join(CANONICAL_DIR, "dataset_manifest.json"));
  const characterIdByName = new Map(charactersDocument.records.map((item) => [item.names.zh_cn, item.id]));
  const equipmentIdByName = new Map(equipmentDocument.records.map((item) => [item.names.zh_cn, item.id]));

  mergeCanonicalCharacters(charactersDocument.records, datasets.characters, characterPages, capturedAt);
  mergeCanonicalBonds(bondsDocument.records, datasets.bonds, bondPages, characterIdByName, capturedAt);
  mergeCanonicalEquipment(equipmentDocument.records, datasets.equipment, characterIdByName, equipmentIdByName, capturedAt);
  mergeCanonicalEnvironments(environmentsDocument.records, datasets.environments, capturedAt);
  manifest.dataset_version = `cw-4.4-${capturedAt.slice(0, 10)}`;
  manifest.generated_at = capturedAt;

  return [
    [join(CANONICAL_DIR, "characters.json"), charactersDocument],
    [join(CANONICAL_DIR, "bonds.json"), bondsDocument],
    [join(CANONICAL_DIR, "equipment.json"), equipmentDocument],
    [join(CANONICAL_DIR, "investment_environments.json"), environmentsDocument],
    [join(CANONICAL_DIR, "dataset_manifest.json"), manifest],
  ];
}

function mergeCanonicalCharacters(records, details, pages, capturedAt) {
  const byName = new Map(details.map((item) => [item.name, item]));
  for (const record of records) {
    const detail = byName.get(record.names.zh_cn);
    if (!detail) continue;
    record.empowerment = {
      on_field: detail.empowerment.front,
      off_field: detail.empowerment.back,
      star_levels: Object.entries(detail.empowerment.stars).map(([star, stats]) => ({ star: Number(star), stats })),
    };
    record.recommended_equipment = detail.recommended_equipment;
    record.expert_advisor.status = detail.advisor ? "active" : "inactive";
    markVerified(record, capturedAt);
    record.missing_fields = (record.missing_fields ?? []).filter((item) => !item.field.startsWith("empowerment"));
    const page = pages.get(`货币战争/${detail.name}`);
    replaceEvidence(record, "bwiki_characters", page, capturedAt, ["empowerment", "recommended_equipment", "expert_advisor"]);
  }
}

function mergeCanonicalBonds(records, details, pages, characterIdByName, capturedAt) {
  const byName = new Map(details.map((item) => [item.name, item]));
  for (const record of records) {
    const detail = byName.get(record.names.zh_cn);
    if (!detail) continue;
    record.member_ids = detail.members.map((name) => characterIdByName.get(name)).filter(Boolean);
    record.base_effect = detail.base_effect;
    record.tiers = Object.entries(detail.effects).map(([required_members, effect_text]) => ({
      required_members: Number(required_members),
      effect_text,
    }));
    record.special_rules = detail.special_rules.map((text) => ({ text }));
    markVerified(record, capturedAt);
    record.missing_fields = (record.missing_fields ?? []).filter((item) => !["tiers", "effect_summary"].includes(item.field));
    const page = pages.get(`货币战争/羁绊/${detail.name}`);
    replaceEvidence(record, "bwiki_bonds", page, capturedAt, ["member_ids", "base_effect", "tiers", "special_rules"]);
  }
}

function mergeCanonicalEquipment(records, details, characterIdByName, equipmentIdByName, capturedAt) {
  const byName = new Map(details.map((item) => [item.name, item]));
  for (const record of records) {
    const detail = byName.get(record.names.zh_cn);
    if (!detail) continue;
    record.tags = detail.tags;
    record.base_stats = Object.entries(detail.stats).map(([stat, raw]) => toCanonicalStat(stat, raw));
    record.effect.current_text = detail.effect;
    record.effect.status = detail.effect ? "current" : "no_separate_effect_base_attribute_only";
    record.effect.parse_status = "source_text";
    const recipes = detail.recipes ?? (detail.recipe ? [detail.recipe] : []);
    record.recipe = {
      ...record.recipe,
      type: recipes.length > 1 ? "alternative_components" : recipes.length === 1 ? "components" : "none",
      component_ids: (recipes[0] ?? []).map((name) => equipmentIdByName.get(name)).filter(Boolean),
      alternatives: recipes.map((recipe) => recipe.map((name) => equipmentIdByName.get(name)).filter(Boolean)),
    };
    record.recommendations.character_ids = detail.recommended_for.map((name) => characterIdByName.get(name)).filter(Boolean);
    record.recommendations.evidence_level = detail.recommended_for.length ? "community_wiki" : "none";
    markVerified(record, capturedAt);
    record.missing_fields = (record.missing_fields ?? []).filter((item) => item.field !== "recipe");
  }
}

function mergeCanonicalEnvironments(records, details, capturedAt) {
  const byName = new Map(details.map((item) => [item.name, item]));
  for (const record of records) {
    const detail = byName.get(record.names.zh_cn);
    if (!detail) continue;
    record.effect.current_text = detail.effect;
    record.effect.status = detail.effect ? "current_candidate" : "source_missing";
    record.effect.parse_status = detail.effect ? "source_text" : "unparsed";
    record.freshness = {
      status: "current_candidate",
      target_version: GAME_VERSION,
      source_version: GAME_VERSION,
      reason: "BWIKI结构化页面已采集；非官方数据仍建议游戏内复核。",
    };
    markVerified(record, capturedAt);
    record.missing_fields = detail.effect
      ? (record.missing_fields ?? []).filter((item) => !item.field.startsWith("effect"))
      : record.missing_fields;
  }
}

function markVerified(record, capturedAt) {
  record.version.last_verified = GAME_VERSION;
  record.version.coverage_status = "current_candidate";
  record.review.status = "source_verified";
  record.review.reviewed_at = capturedAt;
}

function replaceEvidence(record, sourceId, page, capturedAt, supportsFields) {
  record.evidence = (record.evidence ?? []).filter((item) => !(item.source_id === sourceId && item.locator?.evidence_type === "detail_page"));
  record.evidence.push({
    source_id: sourceId,
    revision_id: page?.revisionId ?? null,
    captured_at: capturedAt,
    locator: { raw: page?.title ?? record.names.zh_cn, evidence_type: "detail_page" },
    supports_fields: supportsFields,
    confidence: 0.82,
  });
}

function toCanonicalStat(stat, raw) {
  const text = String(raw);
  const percent = text.endsWith("%");
  const numeric = Number(percent ? text.slice(0, -1) : text);
  return {
    stat,
    value: Number.isFinite(numeric) ? numeric : text,
    unit: percent ? "percent" : "flat",
    scope: "wearer",
  };
}

async function updateImportManifest(capturedAt) {
  const path = join(ROOT, "data", "currency-war", "manifests", "import-4.4.json");
  const manifest = await readJson(path);
  manifest.imported_at = capturedAt;
  for (const relativePath of Object.keys(manifest.sha256 ?? {})) {
    const content = await readFile(join(ROOT, "data", "currency-war", relativePath));
    manifest.sha256[relativePath] = createHash("sha256").update(content).digest("hex");
  }
  await writeJsonAtomic(path, manifest);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes("--dry-run");
  enrichCurrencyWarData({ dryRun })
    .then(({ report }) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 1;
    });
}
