import type { JsonSchema, ToolParameters } from "../tools/tool-types.js";

export const MCP_SCHEMA_MAX_DEPTH = 12;
export const MCP_SCHEMA_MAX_BYTES = 32 * 1024;

const TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

export function normalizeMcpInputSchema(value: unknown): ToolParameters {
  if (serializedSize(value) > MCP_SCHEMA_MAX_BYTES) throw new Error("MCP_SCHEMA_TOO_LARGE");
  const normalized = normalizeNode(value, 0);
  if (normalized.type !== "object") throw new Error("MCP_SCHEMA_ROOT_INVALID");
  return {
    ...normalized,
    type: "object",
    properties: normalized.properties ?? {},
  };
}

function normalizeNode(value: unknown, depth: number): JsonSchema {
  if (depth > MCP_SCHEMA_MAX_DEPTH) throw new Error("MCP_SCHEMA_TOO_DEEP");
  if (!isRecord(value)) throw new Error("MCP_SCHEMA_INVALID");
  const output: JsonSchema = {};
  if (value.type !== undefined) {
    if (typeof value.type !== "string" || !TYPES.has(value.type)) {
      throw new Error("MCP_SCHEMA_INVALID");
    }
    output.type = value.type as JsonSchema["type"];
  }
  if (typeof value.description === "string") output.description = value.description.slice(0, 2_000);
  if (value.properties !== undefined) {
    if (!isRecord(value.properties)) throw new Error("MCP_SCHEMA_INVALID");
    output.properties = Object.create(null) as Record<string, JsonSchema>;
    for (const [name, child] of Object.entries(value.properties)) {
      if (!name || name.length > 128) throw new Error("MCP_SCHEMA_INVALID");
      output.properties[name] = normalizeNode(child, depth + 1);
    }
  }
  if (value.items !== undefined) output.items = normalizeNode(value.items, depth + 1);
  if (value.required !== undefined) {
    if (!Array.isArray(value.required) || value.required.some((item) => typeof item !== "string")) {
      throw new Error("MCP_SCHEMA_INVALID");
    }
    output.required = [...new Set(value.required as string[])];
  }
  if (value.enum !== undefined) {
    if (!Array.isArray(value.enum)
      || value.enum.some((item) => item !== null && !["string", "number", "boolean"].includes(typeof item))) {
      throw new Error("MCP_SCHEMA_INVALID");
    }
    output.enum = value.enum as Array<string | number | boolean | null>;
  }
  if (typeof value.additionalProperties === "boolean") {
    output.additionalProperties = value.additionalProperties;
  } else if (value.additionalProperties !== undefined) {
    output.additionalProperties = normalizeNode(value.additionalProperties, depth + 1);
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    const item = value[key];
    if (item === undefined) continue;
    if (!Array.isArray(item) || item.length === 0 || item.length > 20) {
      throw new Error("MCP_SCHEMA_INVALID");
    }
    output[key] = item.map((child) => normalizeNode(child, depth + 1));
  }
  return output;
}

function serializedSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    throw new Error("MCP_SCHEMA_INVALID");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
