import { describe, expect, it, vi } from "vitest";
import { createMemoryCompressionVerifier, parseCompressionVerification } from "../../src/main/memory/memory-compression-verifier.js";
import type { CompressionVerificationInput } from "../../src/main/memory/memory-compressor.js";

describe("memory compression verifier", () => {
  it("accepts fully supported unchanged sources", () => expect(parseCompressionVerification(JSON.stringify(validVerification()), input(), 0.9)).toEqual(validVerification()));
  it.each([
    ["low verifier confidence", { ...validVerification(), confidence: 0.89 }],
    ["unsupported claim", { ...validVerification(), claims: [{ claimIndex: 0, supported: false, evidenceIds: ["e1"] }] }],
    ["unknown evidence", { ...validVerification(), claims: [{ claimIndex: 0, supported: true, evidenceIds: ["x"] }] }],
  ])("rejects %s", (_name, value) => expect(() => parseCompressionVerification(JSON.stringify(value), input(), 0.9)).toThrow());
  it("rejects proposal confidence below threshold and stale sources", () => {
    const low = input(); low.proposal.confidence = 0.89;
    expect(() => parseCompressionVerification(JSON.stringify(validVerification()), low, 0.9)).toThrow();
    const stale = input(); stale.sources[0].updatedAt = "2026-08-01T00:00:00.000Z";
    expect(() => parseCompressionVerification(JSON.stringify(validVerification()), stale, 0.9)).toThrow();
  });
  it("rejects turning sometimes into always without absolute evidence", () => {
    const value = input(); value.proposal.summary = "Always uses TypeScript"; value.proposal.claims[0].text = "Always uses TypeScript";
    expect(() => parseCompressionVerification(JSON.stringify(validVerification()), value, 0.9)).toThrow();
  });
  it("uses a separate tools-free completion call", async () => {
    const request = vi.fn(async (_input: unknown) => ({ text: JSON.stringify(validVerification()) }));
    const verifier = createMemoryCompressionVerifier({ getConfig: () => ({ provider: "deepseek", baseUrl: "x", model: "x", apiKey: "fake" }), adapter: { id: "fake" } as never, requestCompletion: request as never });
    await verifier.verify(input());
    expect((request.mock.calls[0]![0] as { tools: unknown[] }).tools).toEqual([]);
  });
});
function input(): CompressionVerificationInput { return { proposal: { summary: "Sometimes uses TypeScript", sourceMemoryIds: ["m1", "m2", "m3"], sourceSnapshots: [1, 2, 3].map((day) => ({ memoryId: `m${day}`, updatedAt: `2026-07-0${day}T00:00:00.000Z` })), evidenceIds: ["e1"], claims: [{ text: "Sometimes uses TypeScript", evidenceIds: ["e1"] }], confidence: 0.95, importance: "high", reason: "repeated" }, sources: [1, 2, 3].map((day) => ({ id: `m${day}`, content: "I sometimes use TypeScript", updatedAt: `2026-07-0${day}T00:00:00.000Z` })), evidence: [{ id: "e1", memoryId: "m1", quote: "I sometimes use TypeScript" }] }; }
function validVerification() { return { supported: true, confidence: 0.95, claims: [{ claimIndex: 0, supported: true, evidenceIds: ["e1"] }], reason: "supported" }; }
