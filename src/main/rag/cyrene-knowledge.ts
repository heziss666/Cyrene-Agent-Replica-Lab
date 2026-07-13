import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { KnowledgeDocument } from "./rag-types.js";
import {
  loadMarkdownKnowledgeDirectory,
  parseMarkdownKnowledge,
} from "./markdown-knowledge-loader.js";

const COLLECTION = "cyrene-worldbook";

export function defaultCyreneKnowledgeDir(): string {
  return fileURLToPath(new URL("../../../resources/cyrene/knowledge/", import.meta.url));
}

function loadCanonDocuments(knowledgeDir: string): KnowledgeDocument[] {
  const markdown = readFileSync(join(knowledgeDir, "canon_quotes.md"), "utf8");
  const sectioned = markdown.replace(
    /^\*\*【+(.+?)】+\*\*\s*$/gm,
    "## $1",
  );
  return parseMarkdownKnowledge({
    relativePath: "canon_quotes.md",
    markdown: sectioned,
    collection: COLLECTION,
  });
}

export function loadCyreneKnowledgeDocuments(
  knowledgeDir = defaultCyreneKnowledgeDir(),
): KnowledgeDocument[] {
  if (
    !existsSync(join(knowledgeDir, "worldbook"))
    || !existsSync(join(knowledgeDir, "canon_quotes.md"))
  ) {
    throw new Error(`Cyrene knowledge corpus is empty: ${knowledgeDir}`);
  }
  const worldbook = loadMarkdownKnowledgeDirectory({
    directory: join(knowledgeDir, "worldbook"),
    sourcePrefix: "worldbook",
    collection: COLLECTION,
  });
  const documents = [...worldbook, ...loadCanonDocuments(knowledgeDir)];
  if (documents.length === 0) {
    throw new Error(`Cyrene knowledge corpus is empty: ${knowledgeDir}`);
  }
  return documents;
}
