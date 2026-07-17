import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpRuntime } from "../../src/main/mcp/create-mcp-runtime.js";
import { ToolRegistry } from "../../src/main/tools/tool-registry.js";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe("create MCP runtime", () => {
  it("assembles an empty runtime that shuts down cleanly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cyrene-mcp-runtime-"));
    dirs.push(dir);
    const runtime = createMcpRuntime({
      configPath: join(dir, "mcp-servers.json"),
      registry: new ToolRegistry(),
      emitApproval: () => false,
    });

    await runtime.manager.initialize();
    expect(runtime.manager.snapshot()).toEqual({ servers: [] });
    await runtime.shutdown();
    expect(runtime.pendingBackgroundTaskCount()).toBe(0);
  });
});
