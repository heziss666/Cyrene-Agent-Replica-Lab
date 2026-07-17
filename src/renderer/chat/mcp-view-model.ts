import type { McpServerView, McpStatusView } from "../../shared/mcp-api-types.js";

export interface McpServerViewModel {
  id: string;
  statusLabel: string;
  statusTone: "neutral" | "working" | "success" | "danger";
  canReconnect: boolean;
}

const STATUS_ORDER: Record<McpStatusView, number> = {
  connected: 0,
  connecting: 1,
  reconnecting: 1,
  disconnected: 2,
  disabled: 3,
  disconnecting: 3,
  error: 4,
};

export function sortMcpServers(servers: readonly McpServerView[]): McpServerView[] {
  return [...servers].sort((left, right) =>
    STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
    || left.id.localeCompare(right.id));
}

export function mcpStatusLabel(status: McpStatusView): string {
  return status.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

export function toMcpServerViewModel(server: McpServerView): McpServerViewModel {
  const statusTone = server.status === "connected"
    ? "success"
    : server.status === "error"
      ? "danger"
      : server.status === "connecting" || server.status === "reconnecting"
        ? "working"
        : "neutral";
  return {
    id: server.id,
    statusLabel: mcpStatusLabel(server.status),
    statusTone,
    canReconnect: server.enabled && server.status !== "connecting" && server.status !== "reconnecting",
  };
}
