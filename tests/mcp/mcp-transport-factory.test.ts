import { describe, expect, it, vi } from "vitest";
import {
  createMcpTransportFactory,
  resolveEnvironmentReference,
} from "../../src/main/mcp/mcp-transport-factory.js";

describe("MCP transport factory", () => {
  it("resolves exact environment references and rejects missing values", () => {
    expect(resolveEnvironmentReference("${TOKEN}", { TOKEN: "secret" })).toBe("secret");
    expect(() => resolveEnvironmentReference("${MISSING}", {})).toThrow("MCP_ENV_MISSING");
  });

  it("creates stdio without shell parsing and resolves env in Main", async () => {
    const createStdio = vi.fn(() => ({ kind: "stdio" } as never));
    const factory = createMcpTransportFactory({
      env: { TOKEN: "secret", PATH: "C:\\bin" },
      createStdio,
    });

    await factory.create({
      id: "demo",
      name: "Demo",
      transport: "stdio",
      enabled: true,
      trust: "ask-sensitive",
      command: "node",
      args: ["server.js", "--flag"],
      env: { TOKEN: "${TOKEN}" },
      toolOverrides: {},
    });

    expect(createStdio).toHaveBeenCalledWith(expect.objectContaining({
      command: "node",
      args: ["server.js", "--flag"],
      env: expect.objectContaining({ TOKEN: "secret" }),
      stderr: "pipe",
    }));
  });

  it("creates Streamable HTTP with resolved headers", async () => {
    const createHttp = vi.fn(() => ({ kind: "http" } as never));
    const factory = createMcpTransportFactory({
      env: { AUTH: "Bearer secret" },
      createHttp,
    });

    await factory.create({
      id: "remote",
      name: "Remote",
      transport: "streamable-http",
      enabled: true,
      trust: "ask-sensitive",
      url: "https://example.com/mcp",
      headers: { Authorization: "${AUTH}" },
      toolOverrides: {},
    });

    expect(createHttp).toHaveBeenCalledWith(
      new URL("https://example.com/mcp"),
      { requestInit: { headers: { Authorization: "Bearer secret" } } },
    );
  });
});
