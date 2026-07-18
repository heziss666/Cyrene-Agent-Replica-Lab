import { describe, expect, it } from "vitest";
import { sanitizeTraceValue } from "../../src/main/runs/trace-sanitizer.js";

describe("sanitizeTraceValue", () => {
  it("redacts secret keys and credential-like strings", () => {
    expect(sanitizeTraceValue({ apiKey: "sk-secret", nested: { authorization: "Bearer abc", value: "ok" } })).toEqual({
      apiKey: "[REDACTED]", nested: { authorization: "[REDACTED]", value: "ok" },
    });
    expect(sanitizeTraceValue({ text: "Bearer abcdefghijklmnop" })).toEqual({ text: "[REDACTED]" });
  });

  it("bounds arrays and recursion", () => {
    const result = sanitizeTraceValue({ items: Array.from({ length: 60 }, (_, i) => i) }) as { items: unknown[] };
    expect(result.items).toHaveLength(50);
  });
});
