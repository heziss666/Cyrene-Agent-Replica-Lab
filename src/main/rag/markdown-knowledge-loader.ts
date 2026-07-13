import { readFileSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { KnowledgeDocument } from "./rag-types.js";

export interface ParseMarkdownKnowledgeInput {
  relativePath: string;
  markdown: string;
  collection: string;
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n").trim();
}

function slug(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function pathId(relativePath: string): string {
  const withoutExtension = relativePath.replace(/\.md$/i, "");
  return withoutExtension
    .replace(/\\/g, "/")
    .split("/")
    .map(slug)
    .filter(Boolean)
    .join("_");
}

function titleFromMarkdown(markdown: string, relativePath: string): string {
  const heading = markdown.match(/^#[ \t]+(.+?)\s*$/m)?.[1]?.trim();
  return heading || basename(relativePath, extname(relativePath));
}

function createDocument(
  input: ParseMarkdownKnowledgeInput,
  id: string,
  title: string,
  text: string,
): KnowledgeDocument {
  return {
    id,
    title,
    source: input.relativePath.replace(/\\/g, "/"),
    text,
    metadata: {
      collection: input.collection,
      file: basename(input.relativePath),
      section: title,
    },
  };
}

export function parseMarkdownKnowledge(
  input: ParseMarkdownKnowledgeInput,
): KnowledgeDocument[] {
  const markdown = normalizeMarkdown(input.markdown);
  if (!markdown) return [];

  const matches = [...markdown.matchAll(/^##[ \t]+(.+?)\s*$/gm)];
  const baseId = pathId(input.relativePath);
  if (matches.length === 0) {
    const title = titleFromMarkdown(markdown, input.relativePath);
    return [createDocument(input, baseId, title, markdown)];
  }

  const preamble = markdown.slice(0, matches[0]!.index).trim();
  const duplicateCounts = new Map<string, number>();
  const documents: KnowledgeDocument[] = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const title = match[1]!.trim();
    const sectionStart = match.index + match[0].length;
    const sectionEnd = matches[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(sectionStart, sectionEnd).trim();
    if (!body) continue;

    const titleSlug = slug(title) || "section";
    const duplicateNumber = (duplicateCounts.get(titleSlug) ?? 0) + 1;
    duplicateCounts.set(titleSlug, duplicateNumber);
    const suffix = duplicateNumber === 1 ? "" : `-${duplicateNumber}`;
    const section = `## ${title}\n${body}`;
    const text = preamble ? `${preamble}\n\n${section}` : section;
    documents.push(createDocument(
      input,
      `${baseId}_${titleSlug}${suffix}`,
      title,
      text,
    ));
  }

  return documents;
}

export function loadMarkdownKnowledgeDirectory(input: {
  directory: string;
  sourcePrefix: string;
  collection: string;
}): KnowledgeDocument[] {
  const files = readdirSync(input.directory)
    .filter((file) => file.toLowerCase().endsWith(".md"))
    .sort((left, right) => left.localeCompare(right, "en"));

  return files.flatMap((file) => parseMarkdownKnowledge({
    relativePath: input.sourcePrefix ? `${input.sourcePrefix}/${file}` : file,
    markdown: readFileSync(join(input.directory, file), "utf8"),
    collection: input.collection,
  }));
}
