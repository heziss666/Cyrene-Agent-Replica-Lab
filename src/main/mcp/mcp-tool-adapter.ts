import { createHash } from "node:crypto";
import type { ToolDefinition } from "../tools/tool-types.js";
import type { McpConnection } from "./mcp-connection.js";
import type {
  McpDiscoveredTool,
  McpRisk,
  McpServerConfig,
} from "./mcp-types.js";

export function deriveMcpRisk(tool: McpDiscoveredTool): McpRisk {
  return tool.annotations?.readOnlyHint === true
    && tool.annotations.destructiveHint !== true
    ? "read"
    : "sensitive";
}

export function makeMcpToolId(serverId: string, toolName: string): string {
  const normalized = toolName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "tool";
  const raw = `${serverId}__${normalized}`;
  if (raw.length <= 64) return raw;
  const suffix = createHash("sha256").update(raw).digest("hex").slice(0, 8);
  return `${raw.slice(0, 55)}_${suffix}`;
}

export function adaptMcpTool(input: {
  server: McpServerConfig;
  tool: McpDiscoveredTool;
  connection: Pick<McpConnection, "callTool">;
}): ToolDefinition {
  const override = input.server.toolOverrides[input.tool.name];
  const risk = override?.risk ?? deriveMcpRisk(input.tool);
  return {
    id: makeMcpToolId(input.server.id, input.tool.name),
    description: `[${input.server.name}] ${input.tool.description}`.slice(0, 2_000),
    parameters: input.tool.inputSchema,
    enabled: override?.enabled ?? true,
    metadata: {
      source: "mcp",
      ownerId: input.server.id,
      originalName: input.tool.name,
      risk,
    },
    execute: async (args) => input.connection.callTool(input.tool.name, args),
  };
}
