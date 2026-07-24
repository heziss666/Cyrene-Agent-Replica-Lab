import { describe, expect, it } from "vitest";
import {
  loadCurrencyWarGuidanceDocuments,
} from "../../../src/main/currency-war/rag/currency-war-knowledge.js";

describe("Currency War general guidance knowledge", () => {
  it("loads only 4.4 standard-gambit highest-difficulty guidance and keeps frontmatter as metadata", () => {
    const documents = loadCurrencyWarGuidanceDocuments();

    expect(documents.length).toBeGreaterThan(4);
    expect(documents.every((document) => document.metadata?.collection === "currency-war-general-guidance")).toBe(true);
    expect(documents.every((document) => document.metadata?.gameVersions === "4.4")).toBe(true);
    expect(documents.every((document) => document.metadata?.mode === "standard-gambit")).toBe(true);
    expect(documents.every((document) => document.metadata?.difficulty === "highest-available")).toBe(true);
    expect(documents.some((document) => document.source === "general/standard-node-flow.md")).toBe(true);
    expect(documents.every((document) => !document.text.startsWith("---"))).toBe(true);
  });
});
