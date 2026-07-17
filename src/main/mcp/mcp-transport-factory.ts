import {
  StdioClientTransport,
  getDefaultEnvironment,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "./mcp-types.js";

export interface McpTransportFactory {
  create(config: McpServerConfig): Promise<Transport>;
}

interface McpTransportFactoryOptions {
  env?: NodeJS.ProcessEnv;
  createStdio?: (options: StdioServerParameters) => Transport;
  createHttp?: (url: URL, options: StreamableHTTPClientTransportOptions) => Transport;
}

export function resolveEnvironmentReference(
  reference: string,
  env: NodeJS.ProcessEnv,
): string {
  const match = /^\$\{([A-Z_][A-Z0-9_]*)\}$/.exec(reference);
  if (!match) throw new Error("MCP_ENV_REFERENCE_INVALID");
  const value = env[match[1]];
  if (value === undefined) throw new Error("MCP_ENV_MISSING");
  return value;
}

export function createMcpTransportFactory(
  options: McpTransportFactoryOptions = {},
): McpTransportFactory {
  const env = options.env ?? process.env;
  const createStdio = options.createStdio ?? ((input) => new StdioClientTransport(input));
  const createHttp = options.createHttp
    ?? ((url, input) => new StreamableHTTPClientTransport(url, input));
  return {
    async create(config) {
      if (config.transport === "stdio") {
        const resolved = resolveRecord(config.env, env);
        return createStdio({
          command: config.command,
          args: [...config.args],
          ...(config.cwd ? { cwd: config.cwd } : {}),
          env: { ...getDefaultEnvironment(), ...resolved },
          stderr: "pipe",
        });
      }
      return createHttp(new URL(config.url), {
        requestInit: { headers: resolveRecord(config.headers, env) },
      });
    },
  };
}

function resolveRecord(
  input: Record<string, string>,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = resolveEnvironmentReference(value, env);
  }
  return output;
}
