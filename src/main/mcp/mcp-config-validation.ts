import { z } from "zod";
import type { McpServerConfig } from "./mcp-types.js";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const ENV_REFERENCE_PATTERN = /^\$\{[A-Z_][A-Z0-9_]*\}$/;

const toolOptionsSchema = z.object({
  enabled: z.boolean().optional(),
  risk: z.enum(["read", "sensitive"]).optional(),
}).strict();

const baseShape = {
  id: z.string().min(1).max(64).regex(ID_PATTERN),
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  trust: z.enum(["ask-sensitive", "trusted"]),
  toolOverrides: z.record(z.string().min(1).max(128), toolOptionsSchema),
};

const referenceRecordSchema = z.record(
  z.string().min(1).max(128),
  z.string().max(256).regex(ENV_REFERENCE_PATTERN),
).refine((value) => Object.keys(value).length <= 50);

const stdioSchema = z.object({
  ...baseShape,
  transport: z.literal("stdio"),
  command: z.string().trim().min(1).max(512),
  args: z.array(z.string().max(2048)).max(100),
  cwd: z.string().trim().min(1).max(2048).optional(),
  env: referenceRecordSchema,
}).strict();

const httpSchema = z.object({
  ...baseShape,
  transport: z.literal("streamable-http"),
  url: z.string().max(2048).superRefine((value, context) => {
    try {
      const url = new URL(value);
      const loopback = url.hostname === "localhost"
        || url.hostname === "127.0.0.1"
        || url.hostname === "[::1]";
      if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
        || url.username
        || url.password) {
        context.addIssue({ code: "custom", message: "unsafe MCP URL" });
      }
    } catch {
      context.addIssue({ code: "custom", message: "invalid MCP URL" });
    }
  }),
  headers: referenceRecordSchema,
}).strict();

const serverSchema = z.discriminatedUnion("transport", [stdioSchema, httpSchema]);
const fileSchema = z.object({
  schemaVersion: z.literal(1),
  servers: z.array(serverSchema).max(50),
}).strict();

function assertPlainRecord(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("MCP_CONFIG_INVALID");
  }
}

export function parseMcpServerConfig(value: unknown): McpServerConfig {
  assertPlainRecord(value);
  const result = serverSchema.safeParse(value);
  if (!result.success) throw new Error("MCP_CONFIG_INVALID");
  return result.data;
}

export function parseMcpServerConfigsFile(value: unknown): McpServerConfig[] {
  assertPlainRecord(value);
  const result = fileSchema.safeParse(value);
  if (!result.success) throw new Error("MCP_CONFIG_INVALID");
  const ids = new Set<string>();
  for (const server of result.data.servers) {
    if (ids.has(server.id)) throw new Error("MCP_CONFIG_INVALID");
    ids.add(server.id);
  }
  return result.data.servers;
}
