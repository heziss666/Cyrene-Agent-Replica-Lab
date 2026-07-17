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
}): McpRuntime {
  const approvalBroker = createMcpApprovalBroker({ emit: options.emitApproval });
  const transportFactory = createMcpTransportFactory({ env: options.env });
  const manager = createMcpManager({
    store: createMcpConfigStore(options.configPath),
    registry: options.registry,
    requestApproval: (input) => approvalBroker.request(input),
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
