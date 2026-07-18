import { createHash } from "node:crypto";
import type { ToolDefinition } from "../tools/tool-types.js";
import type { McpConnection } from "./mcp-connection.js";
import { policyForMcpTool, type McpApprovalDecision } from "./mcp-permission.js";
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
  requestApproval?: (input: {
    serverId: string;
    toolId: string;
    toolName: string;
    args: Record<string, unknown>;
  }) => Promise<McpApprovalDecision>;
}): ToolDefinition {
  const override = input.server.toolOverrides[input.tool.name];
  const risk = override?.risk ?? deriveMcpRisk(input.tool);
  const toolId = makeMcpToolId(input.server.id, input.tool.name);
  return {
    id: toolId,
    description: `[${input.server.name}] ${input.tool.description}`.slice(0, 2_000),
    parameters: input.tool.inputSchema,
    enabled: override?.enabled ?? true,
    metadata: {
      source: "mcp",
      ownerId: input.server.id,
      originalName: input.tool.name,
      risk,
    },
    execute: async (args, context) => {
      const policy = context?.executionMode === "scheduled" && risk === "sensitive"
        ? "ask"
        : policyForMcpTool(risk, input.server.trust);
      if (policy === "ask") {
        const decision = input.requestApproval
          ? await input.requestApproval({
              serverId: input.server.id,
              toolId,
              toolName: input.tool.name,
              args,
            })
          : { allowed: false, reason: "NO_APPROVAL_WINDOW" as const };
        if (!decision.allowed) return `[MCP_PERMISSION_DENIED] ${decision.reason}`;
      }
      return input.connection.callTool(input.tool.name, args);
    },
  };
}
