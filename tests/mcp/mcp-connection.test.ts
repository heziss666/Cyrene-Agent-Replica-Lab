import { describe, expect, it, vi } from "vitest";
import { createMcpConnection, type McpClientLike } from "../../src/main/mcp/mcp-connection.js";
import type { McpServerConfig } from "../../src/main/mcp/mcp-types.js";

const config: McpServerConfig = {
  id: "demo",
  name: "Demo",
  transport: "stdio",
  enabled: true,
  trust: "ask-sensitive",
  command: "node",
  args: ["server.js"],
  env: {},
  toolOverrides: {},
};

function fakeClient(overrides: Partial<McpClientLike> = {}): McpClientLike {
  return {
    connect: vi.fn(async () => undefined),
    listTools: vi.fn(async () => ({
      tools: [{
        name: "echo",
        description: "Echo",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
        annotations: { readOnlyHint: true },
      }],
    })),
    callTool: vi.fn(async () => ({ content: [{ type: "text", text: "hello" }] })),
    close: vi.fn(async () => undefined),
    setToolListChangedHandler: vi.fn(),
    ...overrides,
  };
}

describe("MCP connection", () => {
  it("connects, discovers tools, calls a tool, and closes", async () => {
    const client = fakeClient();
    const connection = createMcpConnection({
      config,
      clientFactory: () => client,
      transportFactory: { create: vi.fn(async () => ({}) as never) },
    });

    await connection.connect();
    expect(connection.snapshot()).toMatchObject({ status: "connected", tools: [{ name: "echo" }] });
    expect(await connection.callTool("echo", { text: "hello" })).toBe("hello");
    await connection.close();
    expect(client.close).toHaveBeenCalledOnce();
    expect(connection.snapshot().status).toBe("disconnected");
  });

  it("closes the client when tool discovery fails", async () => {
    const client = fakeClient({ listTools: vi.fn(async () => { throw new Error("bad list"); }) });
    const connection = createMcpConnection({
      config,
      clientFactory: () => client,
      transportFactory: { create: vi.fn(async () => ({}) as never) },
    });

    await expect(connection.connect()).rejects.toThrow("MCP_TOOL_DISCOVERY_FAILED");
    expect(client.close).toHaveBeenCalledOnce();
    expect(connection.snapshot().status).toBe("error");
  });

  it("waits for an active call before closing", async () => {
    let finish!: () => void;
    const client = fakeClient({
      callTool: vi.fn(() => new Promise((resolve) => {
        finish = () => resolve({ content: [{ type: "text", text: "done" }] });
      })),
    });
    const connection = createMcpConnection({
      config,
      clientFactory: () => client,
      transportFactory: { create: vi.fn(async () => ({}) as never) },
    });
    await connection.connect();
    const call = connection.callTool("echo", {});
    const close = connection.close({ drainTimeoutMs: 1_000 });

    expect(client.close).not.toHaveBeenCalled();
    finish();
    await expect(call).resolves.toBe("done");
    await close;
    expect(client.close).toHaveBeenCalledOnce();
  });
});
