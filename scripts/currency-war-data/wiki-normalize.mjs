import { parseTemplate } from "./wiki-template-parser.mjs";

export function stripWikiMarkup(value) {
  let text = String(value ?? "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/\[\[(?:文件|File):[^\]]+\]\]/gi, "");
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  text = text.replace(/\[\[([^\]]+)\]\]/g, "$1");
  for (let pass = 0; pass < 8 && text.includes("{{"); pass += 1) {
    text = replaceInnermostTemplates(text);
  }
  return decodeEntities(text)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
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
