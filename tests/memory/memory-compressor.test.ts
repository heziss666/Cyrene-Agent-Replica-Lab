import { describe, expect, it, vi } from "vitest";
import { createMemoryCompressor, parseCompressionProposal } from "../../src/main/memory/memory-compressor.js";

const input = { cluster: ["m1", "m2", "m3"], sources: ["m1", "m2", "m3"].map((id) => ({ id, content: "I sometimes use TypeScript", updatedAt: `2026-07-0${id.slice(1)}T00:00:00.000Z` })), evidence: [{ id: "e1", memoryId: "m1", quote: "I sometimes use TypeScript" }] };
describe("memory compressor", () => {
  it("parses a strict proposal", () => expect(parseCompressionProposal(JSON.stringify(valid()), input)).toEqual(valid()));
  it.each([
    ["too few sources", { ...valid(), sourceMemoryIds: ["m1", "m2"] }],
    ["outside cluster", { ...valid(), sourceMemoryIds: ["m1", "m2", "x"] }],
    ["duplicate IDs", { ...valid(), sourceMemoryIds: ["m1", "m1", "m2"] }],
    ["missing claims", { ...valid(), claims: [] }],
    ["bad importance", { ...valid(), importance: "low" }],
    ["long summary", { ...valid(), summary: "x".repeat(2001) }],
    ["sensitive summary", { ...valid(), summary: "password: secret" }],
  ])("rejects %s", (_name, value) => expect(() => parseCompressionProposal(JSON.stringify(value), input)).toThrow("Invalid memory compression response"));
  it("calls the shared completion client with tools disabled", async () => {
    const request = vi.fn(async (_input: unknown) => ({ text: JSON.stringify(valid()) }));
    const compressor = createMemoryCompressor({ getConfig: () => ({ provider: "deepseek", baseUrl: "x", model: "x", apiKey: "fake" }), adapter: { id: "fake" } as never, requestCompletion: request as never });
    await compressor.compressCluster(input);
    expect((request.mock.calls[0]![0] as { tools: unknown[] }).tools).toEqual([]);
  });
});
function valid() { return { summary: "Sometimes uses TypeScript", sourceMemoryIds: ["m1", "m2", "m3"], evidenceIds: ["e1"], claims: [{ text: "Sometimes uses TypeScript", evidenceIds: ["e1"] }], confidence: 0.95, importance: "high", reason: "repeated" }; }
