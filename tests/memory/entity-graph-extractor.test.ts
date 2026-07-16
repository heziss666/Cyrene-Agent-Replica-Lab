import { describe, expect, it } from "vitest";
import { validateEntityExtraction } from "../../src/main/memory/entity-graph-extractor.js";
import { createEmptyMemoryFileV2, type L2MemoryV2 } from "../../src/main/memory/memory-types.js";

describe("validateEntityExtraction", () => {
  it("accepts continuous source spans and relations with shared provenance", () => {
    const file = fixture();
    expect(validateEntityExtraction({
      entities: [
        { type: "technology", name: "TypeScript", sourceMemoryIds: ["m1"] },
        { type: "project", name: "Cyrene Agent", sourceMemoryIds: ["m1"] },
      ],
      relations: [{ fromName: "TypeScript", toName: "Cyrene Agent", type: "used_in", sourceMemoryIds: ["m1"] }],
    }, file)).toMatchObject({ entities: [{ name: "TypeScript" }, { name: "Cyrene Agent" }] });
  });

  it.each([
    ["unsupported type", { entities: [{ type: "secret", name: "TypeScript", sourceMemoryIds: ["m1"] }], relations: [] }],
    ["invented span", { entities: [{ type: "technology", name: "Rust", sourceMemoryIds: ["m1"] }], relations: [] }],
    ["unknown endpoint", { entities: [{ type: "technology", name: "TypeScript", sourceMemoryIds: ["m1"] }], relations: [{ fromName: "TypeScript", toName: "Missing", type: "uses", sourceMemoryIds: ["m1"] }] }],
  ])("rejects %s", (_name, value) => expect(() => validateEntityExtraction(value, fixture())).toThrow("Invalid entity graph extraction"));

  it("rejects relation provenance not shared by both endpoints", () => {
    const file = fixture();
    file.l2.push(memory("m2", "Python appears here"));
    expect(() => validateEntityExtraction({
      entities: [
        { type: "technology", name: "TypeScript", sourceMemoryIds: ["m1"] },
        { type: "technology", name: "Python", sourceMemoryIds: ["m2"] },
      ],
      relations: [{ fromName: "TypeScript", toName: "Python", type: "compared_with", sourceMemoryIds: ["m1"] }],
    }, file)).toThrow();
  });
});

function fixture() {
  const file = createEmptyMemoryFileV2();
  file.l2.push(memory("m1", "I use TypeScript in Cyrene Agent"));
  file.evidence.push({ id: "e1", memoryId: "m1", quote: "TypeScript in Cyrene Agent", capturedAt: NOW, source: "conversation", sourceMemoryIds: [] });
  return file;
}
const NOW = "2026-07-01T00:00:00.000Z";
function memory(id: string, content: string): L2MemoryV2 {
  return { id, content, confidence: 0.9, importance: "medium", evidenceIds: [], createdAt: NOW, updatedAt: NOW, lastAccessedAt: NOW, accessCount: 0, weight: 0.6, isPinned: false, isEnabled: true, status: "active", syncStatus: "synced", isSummary: false, sourceMemoryIds: [], sourceSnapshots: [], conflictWith: [] };
}
