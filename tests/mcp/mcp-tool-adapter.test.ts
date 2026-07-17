import { describe, expect, it, vi } from "vitest";
import {
  adaptMcpTool,
  deriveMcpRisk,
  makeMcpToolId,
} from "../../src/main/mcp/mcp-tool-adapter.js";
import type { McpDiscoveredTool, McpServerConfig } from "../../src/main/mcp/mcp-types.js";

const server: McpServerConfig = {
  id: "demo-server",
  name: "Demo",
  transport: "stdio",
  enabled: true,
  trust: "ask-sensitive",
  command: "node",
  args: [],
  env: {},
  toolOverrides: {},
};

const tool: McpDiscoveredTool = {
  name: "Read File!",
  description: "Read a file",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true, destructiveHint: false },
};

describe("MCP tool adapter", () => {
  it("derives risk conservatively", () => {
    expect(deriveMcpRisk(tool)).toBe("read");
    expect(deriveMcpRisk({ ...tool, annotations: undefined })).toBe("sensitive");
    expect(deriveMcpRisk({ ...tool, annotations: { destructiveHint: true } })).toBe("sensitive");
  });

  it("creates a stable namespaced id and invokes the original name", async () => {
    const callTool = vi.fn(async () => "content");
    const definition = adaptMcpTool({ server, tool, connection: { callTool } });

    expect(definition.id).toBe("demo-server__read_file");
    expect(definition.metadata).toEqual({
      source: "mcp",
      ownerId: "demo-server",
      originalName: "Read File!",
      risk: "read",
    });
    await expect(definition.execute({ path: "a" })).resolves.toBe("content");
    expect(callTool).toHaveBeenCalledWith("Read File!", { path: "a" });
  });

  it("bounds long generated ids and applies user overrides", () => {
    const id = makeMcpToolId("demo-server", "x".repeat(200));
    expect(id.length).toBeLessThanOrEqual(64);
    const definition = adaptMcpTool({
      server: {
        ...server,
        toolOverrides: { "Read File!": { enabled: false, risk: "sensitive" } },
      },
      tool,
      connection: { callTool: vi.fn() },
    });
    expect(definition.enabled).toBe(false);
    expect(definition.metadata?.risk).toBe("sensitive");
  });
});
