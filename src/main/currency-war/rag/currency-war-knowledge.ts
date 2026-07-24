import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { parseMarkdownKnowledge } from "../../rag/markdown-knowledge-loader.js";
import type { KnowledgeDocument } from "../../rag/rag-types.js";

const COLLECTION = "currency-war-general-guidance";

interface CurrencyWarGuidanceFrontmatter {
  id?: unknown;
  title?: unknown;
  scope?: unknown;
  game_versions?: unknown;
  mode?: unknown;
  difficulty?: unknown;
  evidence_level?: unknown;
  last_verified?: unknown;
  sources?: unknown;
}

export interface CurrencyWarGuidanceFilter {
  gameVersion?: string;
  mode?: "standard-gambit";
  difficulty?: "highest-available";
}

export function defaultCurrencyWarKnowledgeDir(): string {
  return fileURLToPath(new URL("../../../../resources/currency-war/knowledge/", import.meta.url));
}

function requiredString(value: unknown, label: string, file: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`CURRENCY_WAR_GUIDANCE_INVALID_FRONTMATTER: ${file} ${label}`);
  }
  return value.trim();
}

function stringArray(value: unknown, label: string, file: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`CURRENCY_WAR_GUIDANCE_INVALID_FRONTMATTER: ${file} ${label}`);
  }
  return value.map((item) => item.trim());
}

function sourceLabels(value: unknown, file: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`CURRENCY_WAR_GUIDANCE_INVALID_FRONTMATTER: ${file} sources`);
  }
  return value.map((source, index) => {
    if (typeof source === "string" && source.trim()) return source.trim();
    if (typeof source !== "object" || source === null || Array.isArray(source)) {
      throw new Error(`CURRENCY_WAR_GUIDANCE_INVALID_FRONTMATTER: ${file} sources[${index}]`);
    }
    const title = (source as Record<string, unknown>).title;
    const kind = (source as Record<string, unknown>).kind;
    if (typeof title !== "string" || !title.trim() || typeof kind !== "string" || !kind.trim()) {
      throw new Error(`CURRENCY_WAR_GUIDANCE_INVALID_FRONTMATTER: ${file} sources[${index}]`);
    }
    return `${kind}:${title.trim()}`;
  });
}

function matchesFilter(
  metadata: { gameVersions: string[]; mode: string; difficulty: string },
  filter: CurrencyWarGuidanceFilter,
): boolean {
  return (!filter.gameVersion || metadata.gameVersions.includes(filter.gameVersion))
    && (!filter.mode || metadata.mode === filter.mode)
    && (!filter.difficulty || metadata.difficulty === filter.difficulty);
}

export function loadCurrencyWarGuidanceDocuments(
  knowledgeDir = defaultCurrencyWarKnowledgeDir(),
  filter: CurrencyWarGuidanceFilter = {
    gameVersion: "4.4",
    mode: "standard-gambit",
    difficulty: "highest-available",
  },
): KnowledgeDocument[] {
  const generalDir = join(knowledgeDir, "general");
  if (!existsSync(generalDir)) {
    throw new Error(`Currency War guidance corpus is empty: ${generalDir}`);
  }

  const documents = readdirSync(generalDir)
    .filter((file) => file.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right, "en"))
    .flatMap((file) => {
      const parsed = matter(readFileSync(join(generalDir, file), "utf8"));
      const frontmatter = parsed.data as CurrencyWarGuidanceFrontmatter;
      const metadata = {
        id: requiredString(frontmatter.id, "id", file),
        title: requiredString(frontmatter.title, "title", file),
        scope: requiredString(frontmatter.scope, "scope", file),
        gameVersions: stringArray(frontmatter.game_versions, "game_versions", file),
        mode: requiredString(frontmatter.mode, "mode", file),
        difficulty: requiredString(frontmatter.difficulty, "difficulty", file),
        evidenceLevel: requiredString(frontmatter.evidence_level, "evidence_level", file),
        lastVerified: requiredString(frontmatter.last_verified, "last_verified", file),
        sources: sourceLabels(frontmatter.sources, file),
      };
      if (metadata.scope !== "general" || !matchesFilter(metadata, filter)) return [];

      return parseMarkdownKnowledge({
        relativePath: `general/${file}`,
        markdown: parsed.content,
        collection: COLLECTION,
      }).map((document) => ({
        ...document,
        id: `${metadata.id}_${document.id}`,
        title: `${metadata.title} - ${document.title}`,
        metadata: {
          ...document.metadata,
          collection: COLLECTION,
          guidanceId: metadata.id,
          gameVersions: metadata.gameVersions.join(","),
          mode: metadata.mode,
          difficulty: metadata.difficulty,
          evidenceLevel: metadata.evidenceLevel,
          lastVerified: metadata.lastVerified,
          sources: metadata.sources.join(","),
        },
      }));
    });

  if (documents.length === 0) {
    throw new Error(`Currency War guidance corpus is empty after filtering: ${generalDir}`);
  }
  return documents;
}
