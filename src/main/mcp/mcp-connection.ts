import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { normalizeMcpToolResult } from "./mcp-result-normalizer.js";
import { normalizeMcpInputSchema } from "./mcp-schema-normalizer.js";
import type { McpTransportFactory } from "./mcp-transport-factory.js";
import type {
  McpConnectionSnapshot,
  McpDiscoveredTool,
  McpServerConfig,
} from "./mcp-types.js";

export interface McpClientLike {
  connect(transport: Transport): Promise<void>;
  listTools(): Promise<{ tools: unknown[] }>;
  callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
  setToolListChangedHandler(handler: () => void): void;
}

export interface McpConnection {
  connect(): Promise<void>;
  refreshTools(): Promise<readonly McpDiscoveredTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  snapshot(): McpConnectionSnapshot;
  close(options?: { drainTimeoutMs?: number }): Promise<void>;
}

interface CreateMcpConnectionOptions {
  config: McpServerConfig;
  transportFactory: McpTransportFactory;
  clientFactory?: () => McpClientLike;
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
  onClosed?: () => void;
  onToolsChanged?: (tools: readonly McpDiscoveredTool[]) => void;
}

export function createMcpConnection(options: CreateMcpConnectionOptions): McpConnection {
  const client = (options.clientFactory ?? createSdkClient)();
  const connectTimeoutMs = options.connectTimeoutMs ?? 15_000;
  const callTimeoutMs = options.callTimeoutMs ?? 60_000;
  let status: McpConnectionSnapshot["status"] = options.config.enabled ? "disconnected" : "disabled";
  let tools: readonly McpDiscoveredTool[] = [];
  let errorCode: string | undefined;
  let activeCalls = 0;
  let closing = false;
  const drainWaiters = new Set<() => void>();

  async function refreshTools(): Promise<readonly McpDiscoveredTool[]> {
    let result: { tools: unknown[] };
    try {
      result = await withTimeout(client.listTools(), connectTimeoutMs, "MCP_TOOL_DISCOVERY_TIMEOUT");
    } catch (error) {
      throw new Error("MCP_TOOL_DISCOVERY_FAILED", { cause: error });
    }
    const next: McpDiscoveredTool[] = [];
    for (const value of result.tools) {
      try {
        next.push(parseDiscoveredTool(value));
      } catch {
        // One malformed tool must not hide the other valid tools.
      }
    }
    tools = Object.freeze(next);
    options.onToolsChanged?.(tools);
    return tools;
  }

  return {
    async connect() {
      if (!options.config.enabled) {
        status = "disabled";
        return;
      }
      status = "connecting";
      errorCode = undefined;
      closing = false;
      try {
        const transport = await options.transportFactory.create(options.config);
        transport.onclose = () => {
          if (status !== "disconnecting" && status !== "disabled") {
            status = "disconnected";
            options.onClosed?.();
          }
        };
        transport.onerror = () => {
          errorCode = "MCP_TRANSPORT_ERROR";
        };
        await withTimeout(client.connect(transport), connectTimeoutMs, "MCP_CONNECT_TIMEOUT");
        client.setToolListChangedHandler(() => {
          void refreshTools().catch(() => {
            errorCode = "MCP_TOOL_REFRESH_FAILED";
          });
        });
        await refreshTools();
        status = "connected";
      } catch (error) {
        status = "error";
        errorCode = error instanceof Error ? error.message : "MCP_CONNECT_FAILED";
        try {
          await client.close();
        } catch {
          // Preserve the connection error.
        }
        throw error;
      }
    },
    refreshTools,
    async callTool(name, args) {
      if (status !== "connected" || closing || !tools.some((tool) => tool.name === name)) {
        throw new Error("MCP_TOOL_UNAVAILABLE");
      }
      activeCalls += 1;
      try {
        const result = await withTimeout(
          client.callTool({ name, arguments: args }),
          callTimeoutMs,
          "MCP_TOOL_TIMEOUT",
        );
        return normalizeMcpToolResult(result);
      } finally {
        activeCalls -= 1;
        if (activeCalls === 0) {
          for (const resolve of drainWaiters) resolve();
          drainWaiters.clear();
        }
      }
    },
    snapshot() {
      return {
        id: options.config.id,
        name: options.config.name,
        transport: options.config.transport,
        status,
        tools,
        ...(errorCode ? { errorCode } : {}),
      };
    },
    async close(closeOptions = {}) {
      if (status === "disconnected" || status === "disabled") return;
      closing = true;
      status = "disconnecting";
      if (activeCalls > 0) {
        await Promise.race([
          new Promise<void>((resolve) => drainWaiters.add(resolve)),
          delay(closeOptions.drainTimeoutMs ?? 5_000),
        ]);
      }
      try {
        await client.close();
      } finally {
        tools = [];
        status = "disconnected";
      }
    },
  };
}

function createSdkClient(): McpClientLike {
  const client = new Client({ name: "cyrene-agent-replica-lab", version: "0.1.0" });
  return {
    connect: (transport) => client.connect(transport),
    listTools: async () => client.listTools(),
    callTool: async (input) => client.callTool(input),
    close: () => client.close(),
    setToolListChangedHandler(handler) {
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => handler());
    },
  };
}

function parseDiscoveredTool(value: unknown): McpDiscoveredTool {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) {
    throw new Error("MCP_TOOL_INVALID");
  }
  const annotations = isRecord(value.annotations)
    ? {
        ...(typeof value.annotations.readOnlyHint === "boolean"
          ? { readOnlyHint: value.annotations.readOnlyHint }
          : {}),
        ...(typeof value.annotations.destructiveHint === "boolean"
          ? { destructiveHint: value.annotations.destructiveHint }
          : {}),
      }
    : undefined;
  return {
    name: value.name,
    description: typeof value.description === "string"
      ? value.description.slice(0, 2_000)
      : value.name,
    inputSchema: normalizeMcpInputSchema(value.inputSchema),
    ...(annotations ? { annotations } : {}),
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(code)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
