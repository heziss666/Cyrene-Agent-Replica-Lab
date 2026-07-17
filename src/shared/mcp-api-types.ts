export type McpRiskView = "read" | "sensitive";
export type McpTrustView = "ask-sensitive" | "trusted";
export type McpStatusView =
  | "disabled" | "connecting" | "connected" | "reconnecting"
  | "disconnecting" | "disconnected" | "error";

export interface McpToolOptionsInput {
  enabled?: boolean;
  risk?: McpRiskView;
}

interface McpConfigBaseInput {
  id: string;
  name: string;
  enabled: boolean;
  trust: McpTrustView;
  toolOverrides: Record<string, McpToolOptionsInput>;
}

export interface McpStdioConfigInput extends McpConfigBaseInput {
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
}

export interface McpHttpConfigInput extends McpConfigBaseInput {
  transport: "streamable-http";
  url: string;
  headers: Record<string, string>;
}

export type McpServerConfigInput = McpStdioConfigInput | McpHttpConfigInput;
export type McpServerPatchInput = Partial<McpServerConfigInput>;

export interface McpToolView {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  risk: McpRiskView;
}

export interface McpServerView {
  id: string;
  name: string;
  transport: McpServerConfigInput["transport"];
  enabled: boolean;
  trust: McpTrustView;
  status: McpStatusView;
  toolCount: number;
  tools: McpToolView[];
  errorCode?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpSnapshotView {
  servers: McpServerView[];
}

export interface McpApprovalRequestView {
  id: string;
  serverId: string;
  toolId: string;
  toolName: string;
  args: Record<string, unknown>;
  risk: "sensitive";
}

export type McpApprovalListener = (request: McpApprovalRequestView) => void;

export interface McpApi {
  list(): Promise<McpSnapshotView>;
  add(config: McpServerConfigInput): Promise<McpSnapshotView>;
  update(id: string, patch: McpServerPatchInput): Promise<McpSnapshotView>;
  remove(id: string): Promise<McpSnapshotView>;
  reconnect(id: string): Promise<McpSnapshotView>;
  setEnabled(id: string, enabled: boolean): Promise<McpSnapshotView>;
  setToolOptions(
    serverId: string,
    toolName: string,
    options: McpToolOptionsInput,
  ): Promise<McpSnapshotView>;
  onApprovalRequested(listener: McpApprovalListener): () => void;
  resolveApproval(id: string, allowed: boolean): Promise<{ resolved: boolean }>;
}
