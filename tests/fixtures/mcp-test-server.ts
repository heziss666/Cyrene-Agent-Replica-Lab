import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

export function createMcpTestServer(outputDirectory: string): McpServer {
  const server = new McpServer({ name: "cyrene-mcp-test-server", version: "1.0.0" });

  server.registerTool("echo", {
    description: "Return the supplied text unchanged.",
    inputSchema: { text: z.string() },
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async ({ text }) => ({ content: [{ type: "text", text }] }));

  server.registerTool("read_demo", {
    description: "Return deterministic fixture content.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async () => ({ content: [{ type: "text", text: "fixture-ready" }] }));

  server.registerTool("write_demo", {
    description: "Write text only inside the injected test directory.",
    inputSchema: { text: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ text }) => {
    await mkdir(outputDirectory, { recursive: true });
    const path = join(outputDirectory, "mcp-write-demo.txt");
    await writeFile(path, text, "utf8");
    return { content: [{ type: "text", text: `wrote:${path}` }] };
  });

  return server;
}

async function main(): Promise<void> {
  const outputDirectory = process.env.MCP_TEST_DIR;
  if (!outputDirectory) throw new Error("MCP_TEST_DIR is required");
  const server = createMcpTestServer(outputDirectory);
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
