import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createMcpRuntime, type McpRuntime } from "../src/main/mcp/create-mcp-runtime.js";
import type { McpServerConfig } from "../src/main/mcp/mcp-types.js";
import { ToolRegistry } from "../src/main/tools/tool-registry.js";

const root = process.cwd();
const tsxCli = resolve(root, "node_modules/tsx/dist/cli.mjs");
const stdioFixture = resolve(root, "tests/fixtures/mcp-test-server.ts");
const httpFixture = resolve(root, "tests/fixtures/mcp-http-test-server.ts");
const temporaryRoot = await mkdtemp(join(tmpdir(), "cyrene-mcp-smoke-"));
const children: ChildProcess[] = [];
const runtimes: McpRuntime[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function startHttpFixture(outputDirectory: string): Promise<{ child: ChildProcess; port: number }> {
  return new Promise((resolveReady, reject) => {
    const child = spawn(process.execPath, [tsxCli, httpFixture], {
      env: { ...process.env, MCP_TEST_DIR: outputDirectory },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    children.push(child);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`HTTP MCP fixture timed out: ${stderr}`)), 10_000);
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      const line = stdout.split(/\r?\n/).find((item) => item.trim().startsWith("{"));
      if (!line) return;
      clearTimeout(timer);
      const parsed = JSON.parse(line) as { port: number };
      resolveReady({ child, port: parsed.port });
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== null && code !== 0) reject(new Error(`HTTP MCP fixture exited ${code}: ${stderr}`));
    });
  });
}

function makeRuntime(configPath: string): McpRuntime {
  let runtime: McpRuntime;
  runtime = createMcpRuntime({
    configPath,
    registry: new ToolRegistry(),
    emitApproval(request) {
      queueMicrotask(() => runtime.approvalBroker.resolve({ id: request.id, allowed: true }));
      return true;
    },
  });
  runtimes.push(runtime);
  return runtime;
}

async function verifyTransport(label: string, config: McpServerConfig, outputDirectory: string): Promise<void> {
  const runtime = makeRuntime(join(temporaryRoot, `${config.id}.json`));
  await runtime.manager.initialize();
  await runtime.manager.add(config);
  const snapshot = runtime.manager.snapshot().servers[0];
  assert(snapshot?.status === "connected", `${label}: server did not connect`);
  assert(snapshot.tools.length === 3, `${label}: expected 3 tools, got ${snapshot.tools.length}`);

  const tools = runtime.manager.createToolRegistrySnapshot();
  const echo = tools.getById(`${config.id}__echo`);
  const write = tools.getById(`${config.id}__write_demo`);
  assert(echo && write, `${label}: adapted tools are missing`);
  assert(await echo.execute({ text: `${label}-echo` }) === `${label}-echo`, `${label}: echo failed`);
  const writeResult = await write.execute({ text: `${label}-write` });
  assert(writeResult.includes("wrote:"), `${label}: write did not run after approval`);
  const written = await readFile(join(outputDirectory, "mcp-write-demo.txt"), "utf8");
  assert(written === `${label}-write`, `${label}: fixture wrote unexpected content`);
  assert(runtime.approvalBroker.pendingCount() === 0, `${label}: approval was not settled`);
}

try {
  const stdioOutput = join(temporaryRoot, "stdio-output");
  process.env.MCP_TEST_DIR = stdioOutput;
  await verifyTransport("stdio", {
    id: "stdio-test",
    name: "stdio test",
    enabled: true,
    trust: "ask-sensitive",
    toolOverrides: {},
    transport: "stdio",
    command: process.execPath,
    args: [tsxCli, stdioFixture],
    env: { MCP_TEST_DIR: "${MCP_TEST_DIR}" },
  }, stdioOutput);

  const httpOutput = join(temporaryRoot, "http-output");
  const { port } = await startHttpFixture(httpOutput);
  await verifyTransport("http", {
    id: "http-test",
    name: "http test",
    enabled: true,
    trust: "ask-sensitive",
    toolOverrides: {},
    transport: "streamable-http",
    url: `http://127.0.0.1:${port}/mcp`,
    headers: {},
  }, httpOutput);

  process.stdout.write("MCP smoke passed: stdio and Streamable HTTP each exposed 3 tools; echo and approved write_demo succeeded.\n");
} finally {
  await Promise.allSettled(runtimes.map((runtime) => runtime.shutdown()));
  for (const child of children) child.kill("SIGTERM");
  await rm(temporaryRoot, { recursive: true, force: true });
}
