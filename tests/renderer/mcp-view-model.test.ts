import { describe, expect, it } from "vitest";
import {
  mcpStatusLabel,
  sortMcpServers,
  toMcpServerViewModel,
} from "../../src/renderer/chat/mcp-view-model.js";
import type { McpServerView } from "../../src/shared/mcp-api-types.js";

function server(id: string, status: McpServerView["status"]): McpServerView {
  return {
    id,
    name: id,
    transport: "stdio",
    enabled: true,
    trust: "ask-sensitive",
    status,
    toolCount: 0,
    tools: [],
    command: "node",
    args: [],
    env: {},
  };
}

describe("MCP view model", () => {
  it("sorts connected servers first and maps status tones", () => {
    expect(sortMcpServers([
      server("zeta", "error"),
      server("beta", "connected"),
      server("alpha", "connected"),
    ]).map((item) => item.id)).toEqual(["alpha", "beta", "zeta"]);
    expect(mcpStatusLabel("reconnecting")).toBe("Reconnecting");
    expect(toMcpServerViewModel(server("x", "error"))).toMatchObject({
      statusLabel: "Error",
      statusTone: "danger",
      canReconnect: true,
    });
  });
});
