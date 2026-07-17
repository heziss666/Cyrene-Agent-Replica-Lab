import type { ToolRegistry } from "../tools/tool-registry.js";
import { createMcpConfigStore } from "./mcp-config-store.js";
import { createMcpConnection, type McpClientLike } from "./mcp-connection.js";
import { createMcpManager, type McpManager } from "./mcp-manager.js";
import {
  createMcpApprovalBroker,
  type McpApprovalBroker,
  type McpApprovalRequest,
} from "./mcp-permission.js";
import { createMcpTransportFactory } from "./mcp-transport-factory.js";
import type { AgentEvent } from "../agent/agent-events.js";

export interface McpRuntime {
  manager: McpManager;
  approvalBroker: McpApprovalBroker;
  shutdown(): Promise<void>;
  pendingBackgroundTaskCount(): number;
}

export function createMcpRuntime(options: {
  configPath: string;
  registry: ToolRegistry;
  emitApproval: (request: McpApprovalRequest) => boolean;
  env?: NodeJS.ProcessEnv;
  clientFactory?: () => McpClientLike;
  onEvent?: (event: AgentEvent) => void;
}): McpRuntime {
  const approvalBroker = createMcpApprovalBroker({
    emit: options.emitApproval,
    onRequested: (request) => options.onEvent?.({
      type: "mcp_tool_approval_requested",
      serverId: request.serverId,
      toolId: request.toolId,
    }),
    onResolved: (request, decision) => options.onEvent?.({
      type: "mcp_tool_approval_resolved",
      serverId: request.serverId,
      toolId: request.toolId,
      allowed: decision.allowed,
    }),
  });
  const transportFactory = createMcpTransportFactory({ env: options.env });
  const manager = createMcpManager({
    store: createMcpConfigStore(options.configPath),
    registry: options.registry,
    requestApproval: (input) => approvalBroker.request(input),
    onEvent: options.onEvent,
    connectionFactory: (config, hooks) => createMcpConnection({
      config,
      transportFactory,
      ...(options.clientFactory ? { clientFactory: options.clientFactory } : {}),
      onClosed: hooks.onClosed,
      onToolsChanged: hooks.onToolsChanged,
    }),
  });
  return {
    manager,
    approvalBroker,
    async shutdown() {
      approvalBroker.shutdown();
      await manager.shutdown();
    },
    pendingBackgroundTaskCount() {
      return manager.pendingTaskCount() + approvalBroker.pendingCount();
    },
  };
}
