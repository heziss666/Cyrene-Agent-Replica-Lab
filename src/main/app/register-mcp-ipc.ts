import type { McpSnapshotView } from "../../shared/mcp-api-types.js";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import { parseMcpServerConfig } from "../mcp/mcp-config-validation.js";
import type { McpManager } from "../mcp/mcp-manager.js";
import type { McpApprovalBroker } from "../mcp/mcp-permission.js";
import { deriveMcpRisk, makeMcpToolId } from "../mcp/mcp-tool-adapter.js";

type Handler = (_event: unknown, payload?: unknown) => Promise<unknown>;

export interface McpIpcMainLike {
  handle(channel: string, handler: Handler): void;
  removeHandler(channel: string): void;
}

export interface McpIpcRuntime {
  dispose(): void;
}

const HANDLER_CHANNELS = [
  IPC_CHANNELS.mcp.list,
  IPC_CHANNELS.mcp.add,
  IPC_CHANNELS.mcp.update,
  IPC_CHANNELS.mcp.remove,
  IPC_CHANNELS.mcp.reconnect,
  IPC_CHANNELS.mcp.setEnabled,
  IPC_CHANNELS.mcp.setToolOptions,
  IPC_CHANNELS.mcp.resolveApproval,
] as const;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const APPROVAL_ID_PATTERN = /^[a-zA-Z0-9-]{1,128}$/;
const activeRegistrations = new WeakMap<McpIpcMainLike, object>();

export function toMcpSnapshotView(snapshot: ReturnType<McpManager["snapshot"]>): McpSnapshotView {
  return {
    servers: snapshot.servers.map((server) => {
      const config = server.config;
      return {
        id: server.id,
        name: server.name,
        transport: server.transport,
        enabled: server.enabled,
        trust: server.trust,
        status: server.status,
        toolCount: server.tools.length,
        tools: server.tools.map((tool) => ({
          id: makeMcpToolId(server.id, tool.name),
          name: tool.name,
          description: tool.description,
          enabled: config.toolOverrides[tool.name]?.enabled ?? true,
          risk: config.toolOverrides[tool.name]?.risk ?? deriveMcpRisk(tool),
        })),
        ...(server.errorCode ? { errorCode: server.errorCode } : {}),
        ...(config.transport === "stdio"
          ? {
              command: config.command,
              args: [...config.args],
              ...(config.cwd ? { cwd: config.cwd } : {}),
              env: { ...config.env },
            }
          : { url: config.url, headers: { ...config.headers } }),
      };
    }),
  };
}

export function registerMcpIpc(options: {
  ipcMain: McpIpcMainLike;
  manager: Pick<McpManager,
    "snapshot" | "add" | "update" | "remove" | "reconnect" | "setEnabled" | "setToolOptions">;
  approvalBroker: Pick<McpApprovalBroker, "resolve">;
}): McpIpcRuntime {
  const token = {};
  activeRegistrations.set(options.ipcMain, token);
  for (const channel of HANDLER_CHANNELS) options.ipcMain.removeHandler(channel);
  const view = () => toMcpSnapshotView(options.manager.snapshot());

  options.ipcMain.handle(IPC_CHANNELS.mcp.list, async () => view());
  options.ipcMain.handle(IPC_CHANNELS.mcp.add, async (_event, payload) => {
    await options.manager.add(parseMcpServerConfig(payload));
    return view();
  });
  options.ipcMain.handle(IPC_CHANNELS.mcp.update, async (_event, payload) => {
    const record = exactRecord(payload, ["id", "patch"]);
    const id = parseServerId(record.id);
    const patch = plainRecord(record.patch);
    await options.manager.update(id, patch);
    return view();
  });
  for (const [channel, action] of [
    [IPC_CHANNELS.mcp.remove, options.manager.remove],
    [IPC_CHANNELS.mcp.reconnect, options.manager.reconnect],
  ] as const) {
    options.ipcMain.handle(channel, async (_event, payload) => {
      const record = exactRecord(payload, ["id"]);
      await action.call(options.manager, parseServerId(record.id));
      return view();
    });
  }
  options.ipcMain.handle(IPC_CHANNELS.mcp.setEnabled, async (_event, payload) => {
    const record = exactRecord(payload, ["id", "enabled"]);
    if (typeof record.enabled !== "boolean") throw invalidPayload();
    await options.manager.setEnabled(parseServerId(record.id), record.enabled);
    return view();
  });
  options.ipcMain.handle(IPC_CHANNELS.mcp.setToolOptions, async (_event, payload) => {
    const record = exactRecord(payload, ["serverId", "toolName", "options"]);
    const toolName = typeof record.toolName === "string" ? record.toolName : "";
    const toolOptions = exactOptionalToolOptions(record.options);
    if (!toolName || toolName.length > 128) throw invalidPayload();
    await options.manager.setToolOptions(parseServerId(record.serverId), toolName, toolOptions);
    return view();
  });
  options.ipcMain.handle(IPC_CHANNELS.mcp.resolveApproval, async (_event, payload) => {
    const record = exactRecord(payload, ["id", "allowed"]);
    if (typeof record.id !== "string"
      || !APPROVAL_ID_PATTERN.test(record.id)
      || typeof record.allowed !== "boolean") throw invalidPayload();
    return { resolved: options.approvalBroker.resolve({ id: record.id, allowed: record.allowed }) };
  });

  return {
    dispose() {
      if (activeRegistrations.get(options.ipcMain) !== token) return;
      activeRegistrations.delete(options.ipcMain);
      for (const channel of HANDLER_CHANNELS) options.ipcMain.removeHandler(channel);
    },
  };
}

function parseServerId(value: unknown): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw invalidPayload();
  return value;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = plainRecord(value);
  const ownKeys = Reflect.ownKeys(record);
  if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) {
    throw invalidPayload();
  }
  return record;
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidPayload();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalidPayload();
  return value as Record<string, unknown>;
}

function exactOptionalToolOptions(value: unknown): { enabled?: boolean; risk?: "read" | "sensitive" } {
  const record = plainRecord(value);
  if (Reflect.ownKeys(record).some((key) => key !== "enabled" && key !== "risk")) throw invalidPayload();
  if (record.enabled !== undefined && typeof record.enabled !== "boolean") throw invalidPayload();
  if (record.risk !== undefined && record.risk !== "read" && record.risk !== "sensitive") {
    throw invalidPayload();
  }
  return {
    ...(typeof record.enabled === "boolean" ? { enabled: record.enabled } : {}),
    ...(record.risk === "read" || record.risk === "sensitive" ? { risk: record.risk } : {}),
  };
}

function invalidPayload(): Error {
  return new Error("Invalid MCP IPC payload");
}
