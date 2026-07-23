import { stripWikiMarkup } from "./wiki-normalize.mjs";

export function parseEquipmentResult(result) {
  const values = result.printouts ?? {};
  const acquisition = first(values.获取途径) || first(values.获取方式);
  return {
    name: first(values.名称) || result.fulltext || "",
    type: first(values.类型),
    tags: cleanList(values.标签),
    stats: Object.fromEntries(cleanList(values.基础属性)
      .filter((value) => value !== "无")
      .map(parseStat)
      .filter(Boolean)),
    effect: first(values.描述) || null,
    ...(isRecipe(acquisition) ? { recipe: acquisition.split("+").map((item) => item.trim()).filter(Boolean) } : {}),
    recommended_for: cleanList(values.适配角色),
  };
}

export function parseEnvironmentResult(result) {
  const values = result.printouts ?? {};
  return {
    name: first(values.名称) || result.fulltext || "",
    effect: first(values.效果) || null,
  };
}

function parseStat(value) {
  const match = value.match(/^(.+?)(-?\d+(?:\.\d+)?%?)$/);
  return match ? [match[1].trim(), match[2]] : null;
}

function isRecipe(value) {
  return value.includes("+") && !/[，。；]/.test(value);
}

function first(values) {
  return stripWikiMarkup(Array.isArray(values) ? values[0] : values);
}

function cleanList(values) {
  return (Array.isArray(values) ? values : [])
    .map(stripWikiMarkup)
    .filter(Boolean);
}
