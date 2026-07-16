import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntityGraphService } from "../../src/main/memory/entity-graph.js";
import { createEmptyMemoryFileV2, type L2MemoryV2 } from "../../src/main/memory/memory-types.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("EntityGraphService", () => {
  it("deduplicates nodes and relations with deterministic IDs and source unions", async () => {
    const { service, filePath } = await fixture();
    const graph = await service.rebuild(memoryFile(), {
      entities: [
        { type: "technology", name: " TypeScript ", sourceMemoryIds: ["m1"] },
        { type: "technology", name: "TypeScript", sourceMemoryIds: ["m2"] },
        { type: "project", name: "Agent Lab", sourceMemoryIds: ["m1", "m2"] },
      ],
      relations: [
        { fromName: "TypeScript", toName: "Agent Lab", type: "used_in", sourceMemoryIds: ["m1"] },
        { fromName: "TypeScript", toName: "Agent Lab", type: "used_in", sourceMemoryIds: ["m2"] },
      ],
    });
    expect(graph.nodes).toEqual([
      { id: "project:agent lab", type: "project", name: "Agent Lab", sourceMemoryIds: ["m1", "m2"] },
      { id: "technology:typescript", type: "technology", name: "TypeScript", sourceMemoryIds: ["m1", "m2"] },
    ]);
    expect(graph.relations[0].sourceMemoryIds).toEqual(["m1", "m2"]);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(graph);
  });

  it("prunes stale provenance and supports an empty rebuild", async () => {
    const { service } = await fixture(); const file = memoryFile(); file.l2[1].status = "merged";
    const graph = await service.rebuild(file, { entities: [{ type: "technology", name: "TypeScript", sourceMemoryIds: ["m1", "m2"] }], relations: [] });
    expect(graph.nodes[0].sourceMemoryIds).toEqual(["m1"]);
    expect((await service.rebuild(file, { entities: [], relations: [] })).nodes).toEqual([]);
  });

  it("loads a persisted graph and returns defensive snapshots", async () => {
    const { service, filePath } = await fixture(); await service.rebuild(memoryFile(), { entities: [{ type: "technology", name: "TypeScript", sourceMemoryIds: ["m1"] }], relations: [] });
    const loaded = await new EntityGraphService({ filePath }).load(); loaded.nodes.length = 0;
    expect((await new EntityGraphService({ filePath }).load()).nodes).toHaveLength(1);
  });

  it("quarantines corrupt JSON and returns an empty graph", async () => {
    const { service, filePath, directory } = await fixture(); await writeFile(filePath, "{broken", "utf8");
    await expect(service.load()).resolves.toMatchObject({ nodes: [], relations: [] });
    expect((await readdir(directory)).some((name) => name.startsWith("entity-graph.json.corrupt-"))).toBe(true);
  });

  it("keeps the previous readable graph when persistence fails", async () => {
    const { service } = await fixture();
    await service.rebuild(memoryFile(), { entities: [{ type: "technology", name: "TypeScript", sourceMemoryIds: ["m1"] }], relations: [] });
    const failing = new EntityGraphService({ filePath: "ignored", atomicWrite: vi.fn(async () => { throw new Error("disk full"); }) });
    (failing as unknown as { graph: unknown }).graph = service.snapshot();
    await expect(failing.rebuild(memoryFile(), { entities: [], relations: [] })).rejects.toThrow("disk full");
    expect(failing.snapshot().nodes).toHaveLength(1);
  });
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "entity-graph-")); directories.push(directory);
  const filePath = join(directory, "entity-graph.json");
  return { directory, filePath, service: new EntityGraphService({ filePath, now: () => new Date(NOW), quarantineNow: () => 7 }) };
}
const NOW = "2026-07-01T00:00:00.000Z";
function memoryFile() { const file = createEmptyMemoryFileV2(); file.l2.push(memory("m1"), memory("m2")); return file; }
function memory(id: string): L2MemoryV2 { return { id, content: "TypeScript Agent Lab", confidence: 0.9, importance: "medium", evidenceIds: [], createdAt: NOW, updatedAt: NOW, lastAccessedAt: NOW, accessCount: 0, weight: 0.6, isPinned: false, isEnabled: true, status: "active", syncStatus: "synced", isSummary: false, sourceMemoryIds: [], sourceSnapshots: [], conflictWith: [] }; }
