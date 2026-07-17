import { describe, expect, it, vi } from "vitest";
import { createMcpManager } from "../../src/main/mcp/mcp-manager.js";
import type { McpConnection } from "../../src/main/mcp/mcp-connection.js";
import type { McpConfigStore } from "../../src/main/mcp/mcp-config-store.js";
import type { McpDiscoveredTool, McpServerConfig } from "../../src/main/mcp/mcp-types.js";
import { ToolRegistry } from "../../src/main/tools/tool-registry.js";

function config(id: string): McpServerConfig {
  return {
    id,
    name: id,
    transport: "stdio",
    enabled: true,
    trust: "ask-sensitive",
    command: "node",
    args: [],
    env: {},
    toolOverrides: {},
  };
}

const readTool: McpDiscoveredTool = {
  name: "read",
  description: "Read",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true },
};

function createStore(initial: McpServerConfig[] = []): McpConfigStore & { save: ReturnType<typeof vi.fn> } {
  let configs = initial;
  const save = vi.fn(async (next: readonly McpServerConfig[]) => { configs = [...next]; });
  return { load: async () => [...configs], save };
}

function fakeConnection(server: McpServerConfig, tools = [readTool]): McpConnection {
  let status: "disconnected" | "connected" = "disconnected";
  return {
    connect: vi.fn(async () => { status = "connected"; }),
    refreshTools: vi.fn(async () => tools),
    callTool: vi.fn(async (name) => `${server.id}:${name}`),
    snapshot: () => ({
      id: server.id,
      name: server.name,
      transport: server.transport,
      status,
      tools: status === "connected" ? tools : [],
    }),
    close: vi.fn(async () => { status = "disconnected"; }),
  };
}

describe("MCP manager", () => {
  it("restores enabled servers and isolates a failed connection", async () => {
    const registry = new ToolRegistry();
    const store = createStore([config("good"), config("bad")]);
    const manager = createMcpManager({
      store,
      registry,
      connectionFactory: (server) => {
        if (server.id === "bad") {
          const connection = fakeConnection(server);
          connection.connect = vi.fn(async () => { throw new Error("offline"); });
          return connection;
        }
        return fakeConnection(server);
      },
      requestApproval: vi.fn(),
    });

    await manager.initialize();

    expect(registry.getById("good__read")).toBeDefined();
    expect(manager.snapshot().servers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "good", status: "connected" }),
      expect.objectContaining({ id: "bad", status: "error" }),
    ]));
  });

  it("adds, disables, and removes servers transactionally", async () => {
    const registry = new ToolRegistry();
    const store = createStore();
    const manager = createMcpManager({
      store,
      registry,
      connectionFactory: (server) => fakeConnection(server),
      requestApproval: vi.fn(),
    });
    await manager.initialize();

    await manager.add(config("demo"));
    expect(registry.getById("demo__read")).toBeDefined();
    await manager.setEnabled("demo", false);
    expect(registry.getById("demo__read")).toBeUndefined();
    await manager.remove("demo");
    expect(manager.snapshot().servers).toEqual([]);
    expect(store.save).toHaveBeenCalledTimes(3);
  });

  it("asks before executing an untrusted sensitive tool", async () => {
    const sensitive = { ...readTool, name: "write", annotations: { destructiveHint: true } };
    const registry = new ToolRegistry();
    const requestApproval = vi.fn(async () => ({ allowed: false, reason: "USER_DENIED" as const }));
    const manager = createMcpManager({
      store: createStore([config("demo")]),
      registry,
      connectionFactory: (server) => fakeConnection(server, [sensitive]),
      requestApproval,
    });
    await manager.initialize();

    const output = await registry.getById("demo__write")?.execute({ path: "a" });

    expect(output).toBe("[MCP_PERMISSION_DENIED] USER_DENIED");
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      serverId: "demo",
      toolId: "demo__write",
      toolName: "write",
    }));
  });

  it("returns an immutable per-run Registry snapshot", async () => {
    const registry = new ToolRegistry();
    const manager = createMcpManager({
      store: createStore([config("demo")]),
      registry,
      connectionFactory: (server) => fakeConnection(server),
      requestApproval: vi.fn(),
    });
    await manager.initialize();
    const runRegistry = manager.createToolRegistrySnapshot();

    await manager.setEnabled("demo", false);

    expect(runRegistry.getById("demo__read")).toBeDefined();
    expect(registry.getById("demo__read")).toBeUndefined();
  });
});
