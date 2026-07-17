import { describe, expect, it } from "vitest";
import { normalizeMcpInputSchema } from "../../src/main/mcp/mcp-schema-normalizer.js";

describe("MCP schema normalizer", () => {
  it("keeps a supported recursive object schema", () => {
    const schema = {
      type: "object",
      properties: {
        query: { type: "string", description: "Query" },
        options: {
          type: "object",
          properties: { limit: { type: "integer" } },
          additionalProperties: false,
        },
      },
      required: ["query"],
      ignoredKeyword: "drop-me",
    };

    expect(normalizeMcpInputSchema(schema)).toEqual({
      type: "object",
      properties: {
        query: { type: "string", description: "Query" },
        options: {
          type: "object",
          properties: { limit: { type: "integer" } },
          additionalProperties: false,
        },
      },
      required: ["query"],
    });
  });

  it("rejects non-object roots, excessive depth, and excessive size", () => {
    expect(() => normalizeMcpInputSchema({ type: "string" }))
      .toThrow("MCP_SCHEMA_ROOT_INVALID");
    let deep: Record<string, unknown> = { type: "string" };
    for (let index = 0; index < 13; index += 1) {
      deep = { type: "array", items: deep };
    }
    expect(() => normalizeMcpInputSchema({
      type: "object",
      properties: { deep },
    })).toThrow("MCP_SCHEMA_TOO_DEEP");
    expect(() => normalizeMcpInputSchema({
      type: "object",
      description: "x".repeat(33 * 1024),
      properties: {},
    })).toThrow("MCP_SCHEMA_TOO_LARGE");
  });
});
