import { describe, expect, it, vi } from "vitest";
import { createMemoryReflectionVerifier, parseReflectionVerification } from "../../src/main/memory/memory-reflection-verifier.js";
import type { ReflectionProfileUpdate, ReflectionVerificationInput } from "../../src/main/memory/memory-reflection-types.js";

describe("memory reflection verifier", () => {
  it("accepts complete supported claims", () => {
    expect(parseReflectionVerification(JSON.stringify(validVerification()), input(), 0.9)).toEqual(validVerification());
  });

  it.each([
    ["missing claim", { ...validVerification(), claims: [] }],
    ["unknown evidence", { ...validVerification(), claims: [{ claimIndex: 0, supported: true, evidenceIds: ["missing"] }] }],
    ["low confidence", { ...validVerification(), confidence: 0.89 }],
    ["unsupported claim", { ...validVerification(), claims: [{ claimIndex: 0, supported: false, evidenceIds: ["e1"] }] }],
  ])("deterministically rejects %s", (_name, value) => {
    expect(() => parseReflectionVerification(JSON.stringify(value), input(), 0.9)).toThrow("Invalid memory reflection verification");
  });

  it("rejects a stale source snapshot", () => {
    const stale = input();
    stale.sources[0] = { ...stale.sources[0], updatedAt: "2026-07-09T00:00:00.000Z" };
    expect(() => parseReflectionVerification(JSON.stringify(validVerification()), stale, 0.9)).toThrow();
  });

  it("uses a separate JSON-only completion call with tools disabled", async () => {
    const requestCompletion = vi.fn(async (_request: unknown) => ({ text: JSON.stringify(validVerification()) }));
    const verifier = createMemoryReflectionVerifier({
      getConfig: () => ({ provider: "deepseek", baseUrl: "https://example.test", model: "test", apiKey: "fake" }),
      adapter: { id: "fake" } as never,
      requestCompletion: requestCompletion as never,
    });
    await verifier.verify(input(), 0.9);
    expect((requestCompletion.mock.calls[0]![0] as { tools: unknown[] }).tools).toEqual([]);
  });
});

function proposal(): ReflectionProfileUpdate {
  return { layer: "L0", field: "occupation", content: "developer", sourceMemoryIds: ["m1", "m2", "m3"], sourceSnapshots: [{ memoryId: "m1", updatedAt: "2026-07-01T00:00:00.000Z" }, { memoryId: "m2", updatedAt: "2026-07-02T00:00:00.000Z" }, { memoryId: "m3", updatedAt: "2026-07-03T00:00:00.000Z" }], claims: [{ text: "developer", evidenceIds: ["e1"] }], confidence: 0.95, reason: "repeated" };
}
function input(): ReflectionVerificationInput {
  return { proposal: proposal(), sources: proposal().sourceSnapshots!.map((item) => ({ id: item.memoryId, content: "developer", updatedAt: item.updatedAt })), evidence: [{ id: "e1", memoryId: "m1", quote: "developer", capturedAt: "2026-07-01T00:00:00.000Z" }] };
}
function validVerification() {
  return { supported: true, confidence: 0.95, claims: [{ claimIndex: 0, supported: true, evidenceIds: ["e1"] }], reason: "supported" };
}
