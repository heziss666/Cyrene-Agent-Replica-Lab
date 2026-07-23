export function findTemplates(source, expectedName) {
  const templates = [];
  for (let start = source.indexOf("{{"); start >= 0; start = source.indexOf("{{", start + 2)) {
    const end = findTemplateEnd(source, start);
    if (end < 0) break;
    const raw = source.slice(start, end);
    const parsed = parseTemplate(raw);
    if (parsed.name === expectedName) templates.push(parsed);
  }
  return templates;
}

export function parseTemplate(raw) {
  if (!raw.startsWith("{{") || !raw.endsWith("}}")) {
    throw new Error("CURRENCY_WAR_WIKI_TEMPLATE_INVALID");
  }
  const parts = splitTopLevel(raw.slice(2, -2), "|");
  const name = parts.shift()?.trim() ?? "";
  const positional = [];
  const params = {};
  for (const part of parts) {
    const equals = findTopLevelCharacter(part, "=");
    if (equals < 0) {
      positional.push(part.trim());
    } else {
      params[part.slice(0, equals).trim()] = part.slice(equals + 1).trim();
    }
  }
  return { name, positional, params, raw };
}

function findTemplateEnd(source, start) {
  let depth = 0;
  for (let index = start; index < source.length - 1; index += 1) {
    const pair = source.slice(index, index + 2);
    if (pair === "{{") {
      depth += 1;
      index += 1;
    } else if (pair === "}}") {
      depth -= 1;
      index += 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function splitTopLevel(source, separator) {
  const parts = [];
  let start = 0;
  let braces = 0;
  let brackets = 0;
  for (let index = 0; index < source.length; index += 1) {
    const pair = source.slice(index, index + 2);
    if (pair === "{{") {
      braces += 1;
      index += 1;
    } else if (pair === "}}") {
      braces -= 1;
      index += 1;
    } else if (pair === "[[") {
      brackets += 1;
      index += 1;
    } else if (pair === "]]") {
      brackets -= 1;
      index += 1;
    } else if (source[index] === separator && braces === 0 && brackets === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function findTopLevelCharacter(source, character) {
  let braces = 0;
  let brackets = 0;
  for (let index = 0; index < source.length; index += 1) {
    const pair = source.slice(index, index + 2);
    if (pair === "{{") {
      braces += 1;
      index += 1;
    } else if (pair === "}}") {
      braces -= 1;
      index += 1;
    } else if (pair === "[[") {
      brackets += 1;
      index += 1;
    } else if (pair === "]]") {
      brackets -= 1;
      index += 1;
    } else if (source[index] === character && braces === 0 && brackets === 0) {
      return index;
    }
  }
  return -1;
}
