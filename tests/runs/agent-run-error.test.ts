import { describe, expect, it } from "vitest";
import { normalizeAgentRunError } from "../../src/main/runs/agent-run-error.js";

describe("normalizeAgentRunError", () => {
  it("classifies provider and cancellation errors safely", () => {
    expect(normalizeAgentRunError(new Error("Model request failed: HTTP 429 - busy"))).toMatchObject({
      code: "MODEL_HTTP_429", category: "provider", retryable: true, httpStatus: 429,
    });
    expect(normalizeAgentRunError(new DOMException("aborted", "AbortError"))).toMatchObject({
      code: "RUN_CANCELLED", category: "cancelled", retryable: false,
    });
  });
});
