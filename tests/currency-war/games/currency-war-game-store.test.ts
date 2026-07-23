import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultGameState } from "../../../src/main/currency-war/state/game-state-factory.js";
import { createCurrencyWarGameStore } from "../../../src/main/currency-war/games/currency-war-game-store.js";

const roots: string[] = [];
async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "currency-war-games-"));
  roots.push(value);
  return value;
}
afterEach(async () => Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))));

describe("CurrencyWarGameStore", () => {
  it("persists isolated games and the active game", async () => {
    const dir = await root();
    const store = createCurrencyWarGameStore({ rootDir: dir });
    expect(await store.initialize()).toMatchObject({ rebuiltIndex: true });

    await Promise.all([
      store.save(createDefaultGameState("game-1", "阵容一", "2026-07-23T00:00:00.000Z")),
      store.save(createDefaultGameState("game-2", "阵容二", "2026-07-23T00:01:00.000Z")),
    ]);
    await store.setActive("game-1");
    await store.flush();

    expect(await store.list()).toHaveLength(2);
    expect(await store.load("game-2")).toMatchObject({ gameId: "game-2", name: "阵容二" });
    expect(await store.getActiveId()).toBe("game-1");

    const restarted = createCurrencyWarGameStore({ rootDir: dir });
    expect(await restarted.initialize()).toMatchObject({ rebuiltIndex: false });
    expect(await restarted.getActiveId()).toBe("game-1");
  });

  it("removes a game and rejects invalid ids", async () => {
    const store = createCurrencyWarGameStore({ rootDir: await root() });
    await store.initialize();
    await store.save(createDefaultGameState("game-1"));
    await store.remove("game-1");
    expect(await store.load("game-1")).toBeUndefined();
    await expect(store.load("../escape")).rejects.toThrow("CURRENCY_WAR_GAME_ID_INVALID");
  });

  it("rebuilds a corrupt index from valid sessions", async () => {
    const dir = await root();
    const first = createCurrencyWarGameStore({ rootDir: dir });
    await first.initialize();
    await first.save(createDefaultGameState("game-1", "保留"));
    await writeFile(join(dir, "index.json"), "{broken", "utf8");

    const restarted = createCurrencyWarGameStore({ rootDir: dir });
    expect(await restarted.initialize()).toMatchObject({ rebuiltIndex: true });
    expect(await restarted.list()).toEqual([
      expect.objectContaining({ gameId: "game-1", name: "保留" }),
    ]);
    expect(JSON.parse(await readFile(join(dir, "index.json"), "utf8"))).toMatchObject({
      activeGameId: "game-1",
    });
  });
});
