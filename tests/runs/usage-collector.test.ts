import { describe, expect, it } from "vitest";
import { createUsageCollector } from "../../src/main/runs/usage-collector.js";

describe("usage collector", () => {
  it("sums rounds and preserves estimated provenance", () => {
    const usage = createUsageCollector(); usage.add({ inputTokens: 10, outputTokens: 4, source: "provider" }); usage.add({ inputTokens: 5, outputTokens: 2, source: "estimated" });
    expect(usage.snapshot()).toEqual({ inputTokens: 15, outputTokens: 6, totalTokens: 21, source: "estimated" });
  });
});
