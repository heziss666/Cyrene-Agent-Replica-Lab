import { describe, expect, it } from "vitest";
import { hashText } from "../../src/main/rag/text-hash.js";

describe("hashText", () => {
  it("returns the stable UTF-8 SHA-256 digest", () => {
    expect(hashText("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("changes when the chunk text changes", () => {
    expect(hashText("ToolRegistry registers tools.")).not.toBe(
      hashText("ToolRegistry validates and registers tools."),
    );
  });
});
