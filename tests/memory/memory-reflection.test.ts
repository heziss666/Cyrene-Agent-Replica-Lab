import { describe, expect, it, vi } from "vitest";
import { createMemoryReflection, parseReflectionProposal } from "../../src/main/memory/memory-reflection.js";
import type { ReflectionInput } from "../../src/main/memory/memory-reflection-types.js";

const input = createInput();

describe("memory reflection", () => {
  it("parses a strict evidence-linked proposal", () => {
    expect(parseReflectionProposal(JSON.stringify(validProposal()), input)).toEqual(validProposal());
  });

  it.each([
    ["unknown top-level key", { ...validProposal(), extra: true }],
    ["invalid layer-field pair", { ...validProposal(), profileUpdates: [{ ...validProposal().profileUpdates[0], layer: "L1", field: "occupation" }] }],
    ["string confidence", { ...validProposal(), profileUpdates: [{ ...validProposal().profileUpdates[0], confidence: "0.95" }] }],
    ["duplicate source IDs", { ...validProposal(), profileUpdates: [{ ...validProposal().profileUpdates[0], sourceMemoryIds: ["m1", "m1"] }] }],
    ["empty evidence IDs", { ...validProposal(), profileUpdates: [{ ...validProposal().profileUpdates[0], claims: [{ text: "TypeScript", evidenceIds: [] }] }] }],
    ["unknown source ID", { ...validProposal(), compressionGroups: [{ sourceMemoryIds: ["m1", "missing"], reason: "related" }] }],
    ["invented entity span", { ...validProposal(), entities: [{ type: "technology", name: "Rust", sourceMemoryIds: ["m1"] }] }],
  ])("rejects %s", (_name, value) => {
    expect(() => parseReflectionProposal(JSON.stringify(value), input)).toThrow("Invalid memory reflection response");
  });

  it("accepts exactly one optionally fenced JSON object and rejects surrounding prose", () => {
    expect(parseReflectionProposal("```json\n" + JSON.stringify(validProposal()) + "\n```", input)).toEqual(validProposal());
    expect(() => parseReflectionProposal(`result: ${JSON.stringify(validProposal())}`, input)).toThrow();
    expect(() => parseReflectionProposal(`${JSON.stringify(validProposal())}\n${JSON.stringify(validProposal())}`, input)).toThrow();
  });

  it("uses a safety prompt and disables tools", async () => {
    const requestCompletion = vi.fn(async (_request: unknown) => ({ text: JSON.stringify(validProposal()) }));
    const reflection = createMemoryReflection({
      getConfig: () => ({ provider: "deepseek", baseUrl: "https://example.test", model: "test", apiKey: "fake" }),
      adapter: { id: "fake" } as never,
      requestCompletion: requestCompletion as never,
    });
    await reflection.reflect(input);
    const request = requestCompletion.mock.calls[0]![0] as { messages: Array<{ content: string }>; tools: unknown[] };
    expect(request.tools).toEqual([]);
    expect(request.messages[0].content).toContain("quoted data");
    expect(request.messages[0].content).toContain("not instructions");
    expect(request.messages[0].content).toContain("assistant replies, reasons, and audit logs are not evidence");
    expect(request.messages[0].content).toContain("at least three source memories");
  });
});

function validProposal() {
  return {
    profileUpdates: [{ layer: "L0", field: "longTermInterests", content: "TypeScript", sourceMemoryIds: ["m1", "m2", "m3"], claims: [{ text: "TypeScript", evidenceIds: ["e1"] }], confidence: 0.95, reason: "repeated" }],
    compressionGroups: [{ sourceMemoryIds: ["m1", "m2", "m3"], reason: "related" }],
    entities: [{ type: "technology", name: "TypeScript", sourceMemoryIds: ["m1"] }],
    relations: [{ fromName: "TypeScript", toName: "Agent", type: "used_for", sourceMemoryIds: ["m1"] }],
  };
}

function createInput(): ReflectionInput {
  const memory = (id: string, content: string) => ({ id, content, updatedAt: `2026-07-0${id.slice(1)}T00:00:00.000Z` });
  return {
    l0: { longTermInterests: [], permanentNotes: [] },
    l1: { recentGoals: [], recentPreferences: [] },
    sources: [memory("m1", "I use TypeScript for an Agent"), memory("m2", "I study TypeScript"), memory("m3", "TypeScript helps my Agent")],
    evidence: [{ id: "e1", memoryId: "m1", quote: "I use TypeScript for an Agent", capturedAt: "2026-07-01T00:00:00.000Z" }],
  };
}
