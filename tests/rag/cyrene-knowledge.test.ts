import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultCyreneKnowledgeDir,
  loadCyreneKnowledgeDocuments,
} from "../../src/main/rag/cyrene-knowledge.js";

describe("loadCyreneKnowledgeDocuments", () => {
  it("loads sectioned worldbook and canon documents without seed text", () => {
    const documents = loadCyreneKnowledgeDocuments();

    expect(documents.length).toBeGreaterThan(20);
    expect(documents.some((document) => document.source === "worldbook/Cyrene.md")).toBe(true);
    expect(documents.filter((document) => document.source === "canon_quotes.md").length)
      .toBeGreaterThan(5);
    expect(documents.every((document) =>
      document.metadata?.collection === "cyrene-worldbook")).toBe(true);
    expect(documents.some((document) => document.source === "seed")).toBe(false);
    expect(new Set(documents.map((document) => document.id)).size).toBe(documents.length);
  });

  it("resolves the default corpus independently from process.cwd", () => {
    const previous = process.cwd();
    const directory = mkdtempSync(join(tmpdir(), "cyrene-corpus-cwd-"));
    try {
      process.chdir(directory);
      expect(defaultCyreneKnowledgeDir()).toContain("resources");
      expect(loadCyreneKnowledgeDocuments().length).toBeGreaterThan(20);
    } finally {
      process.chdir(previous);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects an empty corpus directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyrene-empty-corpus-"));
    try {
      expect(() => loadCyreneKnowledgeDocuments(directory)).toThrow(
        `Cyrene knowledge corpus is empty: ${directory}`,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
