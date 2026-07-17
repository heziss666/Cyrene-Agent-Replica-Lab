import { describe, expect, it } from "vitest";
import {
  parseMcpServerConfig,
  parseMcpServerConfigsFile,
} from "../../src/main/mcp/mcp-config-validation.js";

const validStdio = {
  id: "demo-files",
  name: "Demo Files",
  transport: "stdio",
  enabled: true,
  trust: "ask-sensitive",
  command: "node",
  args: ["server.js"],
  env: { DEMO_TOKEN: "${DEMO_TOKEN}" },
  toolOverrides: {},
} as const;

describe("MCP config validation", () => {
  it("parses strict stdio and Streamable HTTP configs", () => {
    expect(parseMcpServerConfig(validStdio)).toEqual(validStdio);
    expect(parseMcpServerConfig({
      id: "remote",
      name: "Remote",
      transport: "streamable-http",
      enabled: false,
      trust: "trusted",
      url: "https://example.com/mcp",
      headers: { Authorization: "${REMOTE_AUTH}" },
      toolOverrides: { search: { enabled: false, risk: "read" } },
    }).transport).toBe("streamable-http");
  });

  it("rejects invalid ids, unknown keys, and non-reference secrets", () => {
    expect(() => parseMcpServerConfig({ ...validStdio, id: "Bad ID" }))
      .toThrow("MCP_CONFIG_INVALID");
    expect(() => parseMcpServerConfig({ ...validStdio, extra: true }))
      .toThrow("MCP_CONFIG_INVALID");
    expect(() => parseMcpServerConfig({
      ...validStdio,
      env: { DEMO_TOKEN: "plaintext-secret" },
    })).toThrow("MCP_CONFIG_INVALID");
  });

  it("allows plain HTTP only for loopback hosts and rejects URL credentials", () => {
    expect(() => parseMcpServerConfig({
      id: "local",
      name: "Local",
      transport: "streamable-http",
      enabled: true,
      trust: "ask-sensitive",
      url: "http://127.0.0.1:3000/mcp",
      headers: {},
      toolOverrides: {},
    })).not.toThrow();
    expect(() => parseMcpServerConfig({
      id: "unsafe",
      name: "Unsafe",
      transport: "streamable-http",
      enabled: true,
      trust: "ask-sensitive",
      url: "http://example.com/mcp",
      headers: {},
      toolOverrides: {},
    })).toThrow("MCP_CONFIG_INVALID");
    expect(() => parseMcpServerConfig({
      id: "creds",
      name: "Credentials",
      transport: "streamable-http",
      enabled: true,
      trust: "ask-sensitive",
      url: "https://user:pass@example.com/mcp",
      headers: {},
      toolOverrides: {},
    })).toThrow("MCP_CONFIG_INVALID");
  });

  it("parses only the supported versioned file format", () => {
    expect(parseMcpServerConfigsFile({ schemaVersion: 1, servers: [validStdio] }))
      .toEqual([validStdio]);
    expect(() => parseMcpServerConfigsFile({ schemaVersion: 2, servers: [] }))
      .toThrow("MCP_CONFIG_INVALID");
  });
});
