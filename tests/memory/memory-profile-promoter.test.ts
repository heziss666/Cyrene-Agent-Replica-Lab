import { describe, expect, it } from "vitest";
import { MemoryProfilePromoter } from "../../src/main/memory/memory-profile-promoter.js";
import { createEmptyMemoryFileV2, type MemoryFile, type L2MemoryV2 } from "../../src/main/memory/memory-types.js";
import type { ReflectionProfileUpdate, ReflectionVerification } from "../../src/main/memory/memory-reflection-types.js";

describe("MemoryProfilePromoter", () => {
  it("promotes verified L0 patterns from three distinct capture times", async () => {
    const fixture = createFixture();
    const summary = await fixture.promoter.applyProfileUpdates([proposal("L0", "occupation", ["m1", "m2", "m3"], 0.91)], [verification(0.92)]);
    expect(summary).toEqual({ acceptedCount: 1, skippedCount: 0, acceptedFields: ["L0.occupation"] });
    expect(fixture.read().l0.occupation).toBe("developer");
    expect(fixture.read().l0.fieldMetadata?.occupation).toMatchObject({ source: "reflection", confidence: 0.92 });
  });

  it("promotes L1 from two sources and appends normalized unique arrays", async () => {
    const fixture = createFixture();
    fixture.file.l1.recentGoals = ["Build agent"];
    await fixture.promoter.applyProfileUpdates([proposal("L1", "recentGoals", ["m1", "m2"], 0.85, "  Build   agent ")], [verification(0.85)]);
    expect(fixture.read().l1.recentGoals).toEqual(["Build agent"]);
  });

  it.each([
    ["low verifier confidence", proposal("L0", "occupation", ["m1", "m2", "m3"], 0.95), verification(0.89)],
    ["low proposal confidence", proposal("L0", "occupation", ["m1", "m2", "m3"], 0.89), verification(0.95)],
    ["too few sources", proposal("L0", "occupation", ["m1", "m2"], 0.95), verification(0.95)],
    ["unsupported verification", proposal("L0", "occupation", ["m1", "m2", "m3"], 0.95), { ...verification(0.95), supported: false }],
  ])("skips %s", async (_name, update, verified) => {
    const fixture = createFixture();
    await expect(fixture.promoter.applyProfileUpdates([update], [verified])).resolves.toMatchObject({ acceptedCount: 0, skippedCount: 1 });
  });

  it("protects user edits and rejects stale source snapshots", async () => {
    const fixture = createFixture();
    fixture.file.l0.fieldMetadata!.occupation = { updatedAt: NOW, source: "user_edit" };
    const update = proposal("L0", "occupation", ["m1", "m2", "m3"], 0.95);
    update.sourceSnapshots![0].updatedAt = "2020-01-01T00:00:00.000Z";
    await fixture.promoter.applyProfileUpdates([update], [verification(0.95)]);
    expect(fixture.read().l0.occupation).toBeUndefined();
  });

  it("rejects missing evidence, inactive sources, broken summaries, and sensitive content", async () => {
    const fixture = createFixture();
    fixture.file.l2[0].status = "archived";
    fixture.file.l2[1].isSummary = true;
    fixture.file.l2[1].sourceMemoryIds = ["missing"];
    fixture.file.evidence = [];
    const update = proposal("L0", "occupation", ["m1", "m2", "m3"], 0.95, "password: secret");
    await expect(fixture.promoter.applyProfileUpdates([update], [verification(0.95)])).resolves.toMatchObject({ acceptedCount: 0 });
  });

  it("applies all proposals in one transaction and logs counts without content", async () => {
    const fixture = createFixture();
    await fixture.promoter.applyProfileUpdates([
      proposal("L0", "occupation", ["m1", "m2", "m3"], 0.95),
      proposal("L1", "currentProject", ["m1", "m2"], 0.9, "Agent Lab"),
    ], [verification(0.95), verification(0.9)]);
    expect(fixture.updates).toBe(1);
    expect(fixture.read().reflectionLogs.at(-1)).toMatchObject({ acceptedCount: 2, skippedCount: 0 });
    expect(JSON.stringify(fixture.read().reflectionLogs)).not.toContain("developer");
  });
});

const NOW = "2026-07-16T00:00:00.000Z";
function proposal(layer: "L0" | "L1", field: ReflectionProfileUpdate["field"], ids: string[], confidence: number, content = "developer"): ReflectionProfileUpdate {
  return { layer, field, content, sourceMemoryIds: ids, sourceSnapshots: ids.map((memoryId, index) => ({ memoryId, updatedAt: `2026-07-0${index + 1}T00:00:00.000Z` })), claims: [{ text: content, evidenceIds: ["e1"] }], confidence, reason: "pattern" };
}
function verification(confidence: number): ReflectionVerification { return { supported: true, confidence, claims: [{ claimIndex: 0, supported: true, evidenceIds: ["e1"] }], reason: "supported" }; }
function createFixture() {
  const file = createEmptyMemoryFileV2();
  const memory = (id: string, day: number): L2MemoryV2 => ({ id, content: "developer", confidence: 0.95, importance: "high", evidenceIds: [`e${day}`], createdAt: `2026-07-0${day}T00:00:00.000Z`, updatedAt: `2026-07-0${day}T00:00:00.000Z`, lastAccessedAt: `2026-07-0${day}T00:00:00.000Z`, accessCount: 0, weight: 0.8, isPinned: false, isEnabled: true, status: "active", syncStatus: "synced", isSummary: false, sourceMemoryIds: [], sourceSnapshots: [], conflictWith: [] });
  file.l2.push(memory("m1", 1), memory("m2", 2), memory("m3", 3));
  for (let day = 1; day <= 3; day++) file.evidence.push({ id: `e${day}`, memoryId: `m${day}`, quote: "developer", capturedAt: `2026-07-0${day}T00:00:00.000Z`, source: "conversation", sourceMemoryIds: [] });
  let updates = 0;
  const promoter = new MemoryProfilePromoter({ store: { load: async () => structuredClone(file), update: async (mutator) => { updates++; mutator(file); return structuredClone(file); } }, now: () => new Date(NOW), idFactory: () => "reflection-1" });
  return { file, promoter, read: () => file, get updates() { return updates; } };
}
