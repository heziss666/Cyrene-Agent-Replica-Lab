import type { JsonSchema } from "../tools/tool-types.js";

export type McpRisk = "read" | "sensitive";
export type McpTrust = "ask-sensitive" | "trusted";
export type McpConnectionStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnecting"
  | "disconnected"
  | "error";

export interface McpToolOptions {
  enabled?: boolean;
  risk?: McpRisk;
}

interface McpServerBaseConfig {
  id: string;
  name: string;
  enabled: boolean;
  trust: McpTrust;
  toolOverrides: Record<string, McpToolOptions>;
}

export interface McpStdioServerConfig extends McpServerBaseConfig {
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
}

export interface McpHttpServerConfig extends McpServerBaseConfig {
  transport: "streamable-http";
  url: string;
  headers: Record<string, string>;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

export interface McpDiscoveredTool {
  name: string;
  description: string;
  inputSchema: JsonSchema & { type: "object" };
  annotations?: McpToolAnnotations;
}

export interface McpConnectionSnapshot {
  id: string;
  name: string;
  transport: McpServerConfig["transport"];
  status: McpConnectionStatus;
  tools: readonly McpDiscoveredTool[];
  errorCode?: string;
}

export interface McpServerSnapshot extends McpConnectionSnapshot {
  enabled: boolean;
  trust: McpTrust;
}

export interface McpSnapshot {
  servers: readonly McpServerSnapshot[];
}
