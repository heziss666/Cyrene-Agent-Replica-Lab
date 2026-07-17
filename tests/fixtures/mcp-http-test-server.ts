import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { createMcpTestServer } from "./mcp-test-server.js";

async function main(): Promise<void> {
  const outputDirectory = process.env.MCP_TEST_DIR;
  if (!outputDirectory) throw new Error("MCP_TEST_DIR is required");

  const app = createMcpExpressApp();
  app.post("/mcp", async (request: Request, response: Response) => {
    const server = createMcpTestServer(outputDirectory);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      if (!response.headersSent) response.status(500).json({ error: String(error) });
    }
  });
  app.get("/mcp", (_request: Request, response: Response) => response.status(405).end());
  app.delete("/mcp", (_request: Request, response: Response) => response.status(405).end());

  const listener = app.listen(0, "127.0.0.1", () => {
    const address = listener.address();
    if (!address || typeof address === "string") throw new Error("HTTP fixture did not bind a TCP port");
    process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);
  });

  const close = () => listener.close(() => process.exit(0));
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
