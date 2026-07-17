import { describe, expect, it, vi } from "vitest";
import { registerMcpIpc } from "../../src/main/app/register-mcp-ipc.js";
import { IPC_CHANNELS } from "../../src/shared/ipc-channels.js";

function fakeIpcMain() {
  const handlers = new Map<string, (_event: unknown, payload?: unknown) => Promise<unknown>>();
  return {
    handlers,
    handle(channel: string, handler: (_event: unknown, payload?: unknown) => Promise<unknown>) {
      handlers.set(channel, handler);
    },
    removeHandler(channel: string) {
      handlers.delete(channel);
    },
  };
}

function dependencies() {
  const snapshot = {
    servers: [{
      id: "demo",
      name: "Demo",
      transport: "stdio" as const,
      enabled: true,
      trust: "ask-sensitive" as const,
      status: "connected" as const,
      tools: [{
        name: "read",
        description: "Read",
        inputSchema: { type: "object" as const, properties: {} },
        annotations: { readOnlyHint: true },
      }],
      config: {
        id: "demo",
        name: "Demo",
        transport: "stdio" as const,
        enabled: true,
        trust: "ask-sensitive" as const,
        command: "node",
        args: ["server.js"],
        env: { TOKEN: "${TOKEN}" },
        toolOverrides: {},
      },
    }],
  };
  const manager = {
    snapshot: vi.fn(() => snapshot),
    add: vi.fn(async () => snapshot),
    update: vi.fn(async () => snapshot),
    remove: vi.fn(async () => snapshot),
    reconnect: vi.fn(async () => snapshot),
    setEnabled: vi.fn(async () => snapshot),
    setToolOptions: vi.fn(async () => snapshot),
  };
  const approvalBroker = { resolve: vi.fn(() => true) };
  return { manager, approvalBroker };
}

describe("registerMcpIpc", () => {
  it("returns a renderer-safe snapshot", async () => {
    const ipcMain = fakeIpcMain();
    registerMcpIpc({ ipcMain, ...dependencies() });

    const result = await ipcMain.handlers.get(IPC_CHANNELS.mcp.list)!({});

    expect(result).toEqual({
      servers: [expect.objectContaining({
        id: "demo",
        status: "connected",
        toolCount: 1,
        env: { TOKEN: "${TOKEN}" },
      })],
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("validates add and mutation payloads exactly", async () => {
    const ipcMain = fakeIpcMain();
    const deps = dependencies();
    registerMcpIpc({ ipcMain, ...deps });
    const valid = deps.manager.snapshot().servers[0].config;

    await ipcMain.handlers.get(IPC_CHANNELS.mcp.add)!({}, valid);
    expect(deps.manager.add).toHaveBeenCalledWith(valid);
    await expect(ipcMain.handlers.get(IPC_CHANNELS.mcp.setEnabled)!({}, {
      id: "demo",
      enabled: false,
      path: "C:/secret",
    })).rejects.toThrow("Invalid MCP IPC payload");
  });

  it("resolves only pending approval ids and disposes handlers", async () => {
    const ipcMain = fakeIpcMain();
    const deps = dependencies();
    const runtime = registerMcpIpc({ ipcMain, ...deps });

    await expect(ipcMain.handlers.get(IPC_CHANNELS.mcp.resolveApproval)!({}, {
      id: "approval-1",
      allowed: false,
    })).resolves.toEqual({ resolved: true });
    runtime.dispose();
    expect(ipcMain.handlers.size).toBe(0);
  });
});
