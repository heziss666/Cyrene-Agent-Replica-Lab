import { describe, expect, it } from "vitest";
import { normalizeMcpToolResult } from "../../src/main/mcp/mcp-result-normalizer.js";

describe("MCP result normalizer", () => {
  it("combines text, structured content, resources, and media metadata", () => {
    const output = normalizeMcpToolResult({
      content: [
        { type: "text", text: "hello" },
        { type: "resource_link", name: "Guide", uri: "file:///guide.md", description: "Docs" },
        { type: "image", mimeType: "image/png", data: "AAAA" },
      ],
      structuredContent: { count: 2 },
    });

    expect(output).toContain("hello");
    expect(output).toContain("Guide");
    expect(output).toContain("image/png");
    expect(output).not.toContain("AAAA");
    expect(output).toContain('"count": 2');
  });

  it("marks MCP errors and truncates oversized output", () => {
    expect(normalizeMcpToolResult({
      isError: true,
      content: [{ type: "text", text: "denied" }],
    })).toBe("[MCP_TOOL_ERROR]\ndenied");
    const output = normalizeMcpToolResult({
      content: [{ type: "text", text: "x".repeat(50_000) }],
    });
    expect(output.length).toBeLessThanOrEqual(40_100);
    expect(output).toContain("[MCP_RESULT_TRUNCATED]");
  });
});
