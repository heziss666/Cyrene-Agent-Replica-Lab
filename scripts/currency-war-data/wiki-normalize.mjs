import { parseTemplate } from "./wiki-template-parser.mjs";

const INLINE_STAT_NAMES = new Set([
  "生命增幅",
  "前台强度",
  "后台强度",
  "速度增幅",
  "伤害增幅",
  "幸运一击率",
  "幸运一击伤害",
  "初始能量",
  "击破效率",
  "护盾强度",
  "治疗强度",
  "伤害减免",
  "终结技伤害增幅",
  "普攻伤害增幅",
  "战技伤害增幅",
  "普攻/战技伤害增幅",
  "追加攻击伤害增幅",
  "持续伤害增幅",
  "击破伤害增幅",
]);

export function stripWikiMarkup(value) {
  let text = String(value ?? "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(
    /\[\[(?:文件|File):货币战争-([^|\]]+?)\.(?:png|webp|jpe?g)(?:\|[^\]]*)?\]\]/gi,
    (_match, name) => INLINE_STAT_NAMES.has(name) ? name : "",
  );
  text = text.replace(/\[\[(?:文件|File):[^\]]+\]\]/gi, "");
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  text = text.replace(/\[\[([^\]]+)\]\]/g, "$1");
  for (let pass = 0; pass < 8 && text.includes("{{"); pass += 1) {
    text = replaceInnermostTemplates(text);
  }
  text = decodeEntities(text)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  text = text
    .replace(/前台强度\s*后台强度(?:\s*前\/后台强度)?/g, "前/后台强度")
    .replace(/伤害增幅(?=(?:普攻|战技|终结技|追加攻击|持续|击破))/g, "")
    .replace(/(追加攻击|持续|击破)\1伤害增幅/g, "$1伤害增幅");
  for (const name of INLINE_STAT_NAMES) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`${escapedName}(?:\\s*${escapedName})+`, "g"), name);
  }
  return text;
}

export function splitChineseList(value) {
  return stripWikiMarkup(value)
    .split(/[、，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function replaceInnermostTemplates(source) {
  return source.replace(/\{\{([^{}]*)\}\}/g, (raw) => {
    try {
      const template = parseTemplate(raw);
      if (template.name === "效果说明") return template.positional[0] ?? "";
      if (template.name === "颜色") return template.positional.at(-1) ?? "";
      if (template.name === "图标") return template.positional.at(-1) ?? "";
      return template.positional.at(-1) ?? "";
    } catch {
      return "";
    }
  });
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}
