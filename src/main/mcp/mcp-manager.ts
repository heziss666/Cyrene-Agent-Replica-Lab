import { parseMcpServerConfig } from "./mcp-config-validation.js";
import type { McpConfigStore } from "./mcp-config-store.js";
import type { McpConnection } from "./mcp-connection.js";
import type { McpApprovalDecision, McpApprovalRequestInput } from "./mcp-permission.js";
import { adaptMcpTool, makeMcpToolId } from "./mcp-tool-adapter.js";
import type {
  McpDiscoveredTool,
  McpServerConfig,
  McpServerSnapshot,
  McpSnapshot,
  McpToolOptions,
} from "./mcp-types.js";
import type { ToolRegistry } from "../tools/tool-registry.js";

export interface McpConnectionHooks {
  onClosed: () => void;
  onToolsChanged: (tools: readonly McpDiscoveredTool[]) => void;
}

export interface McpManager {
  initialize(): Promise<void>;
  snapshot(): McpSnapshot;
  add(config: McpServerConfig): Promise<McpSnapshot>;
  update(id: string, patch: Partial<McpServerConfig>): Promise<McpSnapshot>;
  remove(id: string): Promise<McpSnapshot>;
  setEnabled(id: string, enabled: boolean): Promise<McpSnapshot>;
  setToolOptions(id: string, toolName: string, options: McpToolOptions): Promise<McpSnapshot>;
  reconnect(id: string): Promise<McpSnapshot>;
  createToolRegistrySnapshot(): ToolRegistry;
  shutdown(): Promise<void>;
  pendingTaskCount(): number;
}

interface CreateMcpManagerOptions {
  store: McpConfigStore;
  registry: ToolRegistry;
  connectionFactory: (config: McpServerConfig, hooks: McpConnectionHooks) => McpConnection;
  requestApproval: (input: McpApprovalRequestInput) => Promise<McpApprovalDecision>;
  delay?: (milliseconds: number) => Promise<void>;
}

export function createMcpManager(options: CreateMcpManagerOptions): McpManager {
  const configs = new Map<string, McpServerConfig>();
  const connections = new Map<string, McpConnection>();
  const statuses = new Map<string, McpServerSnapshot["status"]>();
  const errors = new Map<string, string>();
  const reconnecting = new Set<string>();
  const reconnectJobs = new Set<Promise<void>>();
  const delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let operation: Promise<unknown> = Promise.resolve();
  let pendingOperations = 0;
  let shuttingDown = false;

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    pendingOperations += 1;
    const result = operation.then(work, work);
    operation = result.catch(() => undefined).finally(() => { pendingOperations -= 1; });
    return result;
  }

  function managerSnapshot(): McpSnapshot {
    return {
      servers: [...configs.values()].map((config): McpServerSnapshot => {
        const connection = connections.get(config.id);
        const state = connection?.snapshot();
        return {
          id: config.id,
          name: config.name,
          transport: config.transport,
          enabled: config.enabled,
          trust: config.trust,
          status: statuses.get(config.id)
            ?? state?.status
            ?? (config.enabled ? "disconnected" : "disabled"),
          tools: state?.tools ?? [],
          ...(errors.has(config.id) ? { errorCode: errors.get(config.id) } : {}),
        };
      }),
    };
  }

  function syncTools(
    config: McpServerConfig,
    connection: McpConnection,
    tools: readonly McpDiscoveredTool[],
  ): void {
    const otherMcpCount = options.registry.getAllTools().filter((tool) =>
      tool.metadata?.source === "mcp" && tool.metadata.ownerId !== config.id).length;
    const allowedCount = Math.max(0, Math.min(50, 100 - otherMcpCount));
    const definitions = tools.slice(0, allowedCount).map((tool) => adaptMcpTool({
      server: config,
      tool,
      connection,
      requestApproval: options.requestApproval,
    }));
    const ids = new Set<string>();
    const valid = definitions.filter((definition) => {
      if (ids.has(definition.id)) return false;
      ids.add(definition.id);
      const existing = options.registry.getById(definition.id);
      return !existing || existing.metadata?.ownerId === config.id;
    });
    options.registry.unregisterByOwner(config.id);
    for (const definition of valid) options.registry.register(definition);
  }

  function scheduleReconnect(id: string): void {
    if (shuttingDown || reconnecting.has(id) || !configs.get(id)?.enabled) return;
    reconnecting.add(id);
    const job = (async () => {
      for (const wait of [1_000, 3_000, 10_000]) {
        if (shuttingDown || !configs.get(id)?.enabled) return;
        statuses.set(id, "reconnecting");
        await delay(wait);
        if (shuttingDown || !configs.get(id)?.enabled) return;
        try {
          await connectServer(configs.get(id)!);
          return;
        } catch {
          // Continue through the finite reconnect schedule.
        }
      }
    })().finally(() => {
      reconnecting.delete(id);
      reconnectJobs.delete(job);
    });
    reconnectJobs.add(job);
  }

  async function connectServer(config: McpServerConfig): Promise<McpConnection> {
    statuses.set(config.id, "connecting");
    errors.delete(config.id);
    const connection = options.connectionFactory(config, {
      onClosed: () => scheduleReconnect(config.id),
      onToolsChanged: (tools) => {
        if (connections.get(config.id) === connection) syncTools(config, connection, tools);
      },
    });
    try {
      await connection.connect();
      connections.set(config.id, connection);
      syncTools(config, connection, connection.snapshot().tools);
      statuses.set(config.id, "connected");
      return connection;
    } catch (error) {
      statuses.set(config.id, "error");
      errors.set(config.id, "MCP_CONNECT_FAILED");
      try { await connection.close(); } catch { /* Preserve the connection failure. */ }
      throw error;
    }
  }

  async function disconnectServer(id: string): Promise<void> {
    options.registry.unregisterByOwner(id);
    const connection = connections.get(id);
    connections.delete(id);
    if (connection) await connection.close();
    statuses.set(id, configs.get(id)?.enabled ? "disconnected" : "disabled");
  }

  async function persist(): Promise<void> {
    await options.store.save([...configs.values()]);
  }

  const manager: McpManager = {
    async initialize() {
      const loaded = await options.store.load();
      for (const config of loaded) configs.set(config.id, config);
      await Promise.all([...configs.values()].map(async (config) => {
        if (!config.enabled) {
          statuses.set(config.id, "disabled");
          return;
        }
        try { await connectServer(config); } catch { /* Exposed in snapshot. */ }
      }));
    },
    snapshot: managerSnapshot,
    add(config) {
      return enqueue(async () => {
        const parsed = parseMcpServerConfig(config);
        if (configs.has(parsed.id)) throw new Error("MCP_SERVER_EXISTS");
        let connection: McpConnection | undefined;
        if (parsed.enabled) connection = await connectServer(parsed);
        configs.set(parsed.id, parsed);
        try {
          await persist();
        } catch (error) {
          configs.delete(parsed.id);
          options.registry.unregisterByOwner(parsed.id);
          await connection?.close();
          throw error;
        }
        if (!parsed.enabled) statuses.set(parsed.id, "disabled");
        return managerSnapshot();
      });
    },
    update(id, patch) {
      return enqueue(async () => {
        const current = configs.get(id);
        if (!current) throw new Error("MCP_SERVER_NOT_FOUND");
        const next = parseMcpServerConfig({ ...current, ...patch, id });
        await disconnectServer(id);
        configs.set(id, next);
        try {
          if (next.enabled) await connectServer(next);
          await persist();
        } catch (error) {
          configs.set(id, current);
          try { if (current.enabled) await connectServer(current); } catch { /* Snapshot reports it. */ }
          throw error;
        }
        return managerSnapshot();
      });
    },
    remove(id) {
      return enqueue(async () => {
        if (!configs.has(id)) throw new Error("MCP_SERVER_NOT_FOUND");
        await disconnectServer(id);
        configs.delete(id);
        statuses.delete(id);
        errors.delete(id);
        await persist();
        return managerSnapshot();
      });
    },
    setEnabled(id, enabled) {
      return enqueue(async () => {
        const current = configs.get(id);
        if (!current) throw new Error("MCP_SERVER_NOT_FOUND");
        if (current.enabled === enabled) return managerSnapshot();
        const next = parseMcpServerConfig({ ...current, enabled });
        if (!enabled) await disconnectServer(id);
        configs.set(id, next);
        try {
          if (enabled) await connectServer(next);
          await persist();
        } catch (error) {
          configs.set(id, current);
          throw error;
        }
        if (!enabled) statuses.set(id, "disabled");
        return managerSnapshot();
      });
    },
    setToolOptions(id, toolName, toolOptions) {
      return enqueue(async () => {
        const current = configs.get(id);
        if (!current) throw new Error("MCP_SERVER_NOT_FOUND");
        if (!current.toolOverrides[toolName] && !connections.get(id)?.snapshot().tools.some((tool) => tool.name === toolName)) {
          throw new Error("MCP_TOOL_NOT_FOUND");
        }
        const next = parseMcpServerConfig({
          ...current,
          toolOverrides: { ...current.toolOverrides, [toolName]: toolOptions },
        });
        configs.set(id, next);
        await persist();
        const connection = connections.get(id);
        if (connection) syncTools(next, connection, connection.snapshot().tools);
        return managerSnapshot();
      });
    },
    reconnect(id) {
      return enqueue(async () => {
        const config = configs.get(id);
        if (!config) throw new Error("MCP_SERVER_NOT_FOUND");
        if (!config.enabled) throw new Error("MCP_SERVER_DISABLED");
        await disconnectServer(id);
        await connectServer(config);
        return managerSnapshot();
      });
    },
    createToolRegistrySnapshot() {
      return options.registry.snapshot();
    },
    async shutdown() {
      shuttingDown = true;
      await operation.catch(() => undefined);
      await Promise.allSettled([...connections.keys()].map(disconnectServer));
      await Promise.allSettled([...reconnectJobs]);
    },
    pendingTaskCount() {
      return pendingOperations + reconnectJobs.size;
    },
  };
  return manager;
}

export function mcpToolIdFor(serverId: string, toolName: string): string {
  return makeMcpToolId(serverId, toolName);
}
