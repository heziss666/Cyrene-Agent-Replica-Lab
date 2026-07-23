import { findTemplates } from "./wiki-template-parser.mjs";
import { stripWikiMarkup } from "./wiki-normalize.mjs";

export function parseBondPage(wikitext) {
  const bond = findTemplates(wikitext, "货币战争/羁绊")[0];
  if (!bond) throw new Error("CURRENCY_WAR_BOND_TEMPLATE_MISSING");

  const effects = {};
  const specialRules = [];
  for (const [key, value] of Object.entries(bond.params)) {
    const tier = key.match(/^羁绊(\d+)级$/)?.[1];
    if (tier) effects[tier] = stripWikiMarkup(value);
    if (/^提示\d*$/.test(key)) {
      const rule = stripWikiMarkup(value);
      if (rule) specialRules.push(rule);
    }
  }

  return {
    name: stripWikiMarkup(bond.positional[0]),
    category: stripWikiMarkup(bond.positional[1]).replace(/羁绊$/, ""),
    members: [],
    base_effect: stripWikiMarkup(bond.params.描述),
    effects,
    special_rules: specialRules,
  };
}
