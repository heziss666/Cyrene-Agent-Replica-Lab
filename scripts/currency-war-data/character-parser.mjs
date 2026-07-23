import { findTemplates } from "./wiki-template-parser.mjs";
import { splitChineseList, stripWikiMarkup } from "./wiki-normalize.mjs";

const FIELD_NAMES = { 前: "前台", 后: "后台", 前后: "前后台", 前台: "前台", 后台: "后台", 前后台: "前后台" };

export function parseCharacterPage(wikitext) {
  const character = findTemplates(wikitext, "货币战争/角色")[0];
  const detail = findTemplates(wikitext, "货币战争/角色/详情")[0];
  if (!character) throw new Error("CURRENCY_WAR_CHARACTER_TEMPLATE_MISSING");

  const name = stripWikiMarkup(character.positional[0]);
  const field = FIELD_NAMES[stripWikiMarkup(character.params.站位)] ?? stripWikiMarkup(character.params.站位);
  const generic = parseGroup(character.params, "");
  let front = parseGroup(character.params, "1");
  let back = parseGroup(character.params, "2");

  if (generic) {
    if (field === "前台") front = generic;
    if (field === "后台") back = generic;
    if (field === "前后台") {
      front = { ...generic, shared: true };
      back = structuredClone(front);
    }
  }

  return {
    name,
    aliases: [],
    cost: parseCost(character.params.费用),
    field,
    roles: splitChineseList(character.params.标签),
    bonds: splitChineseList(character.params.羁绊),
    empowerment: {
      front,
      back,
      stars: parseStars(detail?.params ?? {}),
    },
    recommended_equipment: mergeUnique([
      ...splitChineseList(character.params.推荐装备),
      ...splitChineseList(character.params.推荐装备1),
      ...splitChineseList(character.params.推荐装备2),
    ]),
  };
}

function parseGroup(params, suffix) {
  const content = params[`技能组${suffix}`];
  const name = stripWikiMarkup(params[`技能组名称${suffix}`]);
  const summary = stripWikiMarkup(params[`技能组描述${suffix}`]);
  if (!content && !name && !summary) return null;
  return {
    name,
    summary,
    tags: splitChineseList(params[`技能组标签${suffix}`]),
    skills: findTemplates(content ?? "", "货币战争/角色/技能").map((skill) => ({
      name: stripWikiMarkup(skill.params.名称),
      tags: splitChineseList(skill.params.标签),
      description: stripWikiMarkup(skill.params.描述),
    })),
    shared: false,
  };
}

function parseStars(params) {
  const columns = Object.fromEntries(Object.entries(params).map(([key, value]) => [
    key,
    String(value).split("/").map((item) => parseScalar(stripWikiMarkup(item))),
  ]));
  const count = Math.max(0, ...Object.values(columns).map((values) => values.length));
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [
    String(index + 1),
    Object.fromEntries(Object.entries(columns).map(([key, values]) => [key, values[index]])),
  ]));
}

function parseCost(value) {
  const numbers = String(value ?? "").match(/\d+/g)?.map(Number) ?? [];
  return numbers.length <= 1 ? (numbers[0] ?? 0) : numbers;
}

function parseScalar(value) {
  return /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
}

function mergeUnique(values) {
  return [...new Set(values)];
}
