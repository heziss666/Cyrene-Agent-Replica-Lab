import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpConfigStore } from "../../src/main/mcp/mcp-config-store.js";
import type { McpServerConfig } from "../../src/main/mcp/mcp-types.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempPath(): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "cyrene-mcp-config-"));
  dirs.push(dir);
  return { dir, file: join(dir, "mcp-servers.json") };
}

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

describe("MCP config store", () => {
  it("returns an empty list for a missing file and round-trips configs", async () => {
    const { file } = await tempPath();
    const store = createMcpConfigStore(file);

    expect(await store.load()).toEqual([]);
    await store.save([config]);
    expect(await store.load()).toEqual([config]);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      schemaVersion: 1,
      servers: [config],
    });
  });

  it("quarantines a corrupt file and continues with defaults", async () => {
    const { dir, file } = await tempPath();
    await writeFile(file, "{broken", "utf8");
    const store = createMcpConfigStore(file, { now: () => 123 });

    expect(await store.load()).toEqual([]);
    expect(await readdir(dir)).toContain("mcp-servers.json.corrupt-123");
  });
});
