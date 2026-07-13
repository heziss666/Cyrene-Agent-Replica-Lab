import { describe, expect, it } from "vitest";
import { loadRequiredPrompt } from "../../src/main/prompts/prompt-loader.js";

describe("loadRequiredPrompt", () => {
  it("returns trimmed prompt content", () => {
    expect(loadRequiredPrompt("identity.md", () => "  IDENTITY\n")).toBe("IDENTITY");
  });

  it("throws a path-specific error for missing or empty content", () => {
    expect(() => loadRequiredPrompt("missing.md", () => "")).toThrow(
      "Required prompt file is missing or empty: missing.md",
    );
  });
});
