import { describe, expect, it } from "vitest";
import type { CurrencyWarCatalog } from "../../../src/main/currency-war/data/currency-war-catalog.js";
import type { CurrencyWarGameStore } from "../../../src/main/currency-war/games/currency-war-game-store.js";
import { createCurrencyWarGameService } from "../../../src/main/currency-war/games/currency-war-game-service.js";
import type { CurrencyWarGameState } from "../../../src/shared/currency-war-api-types.js";

function memoryStore(): CurrencyWarGameStore {
  const values = new Map<string, CurrencyWarGameState>();
  let active: string | undefined;
  return {
    initialize: async () => ({ rebuiltIndex: false, quarantinedCount: 0 }),
    list: async () => [...values.values()].map(({ gameId, name, nodeId, status, createdAt, updatedAt }) =>
      ({ gameId, name, nodeId, status, createdAt, updatedAt })),
    load: async (id) => structuredClone(values.get(id)),
    save: async (state) => { values.set(state.gameId, structuredClone(state)); active ??= state.gameId; },
    remove: async (id) => { values.delete(id); if (active === id) active = values.keys().next().value; },
    setActive: async (id) => { if (!values.has(id)) throw new Error("CURRENCY_WAR_GAME_NOT_FOUND"); active = id; },
    getActiveId: async () => active,
    flush: async () => undefined,
  };
}
const catalog = {
  list: () => [],
  getByName: () => undefined,
  findByName: () => [],
  getRelated: () => [],
} satisfies CurrencyWarCatalog;

describe("CurrencyWarGameService", () => {
  it("assigns the smallest unused default game number", async () => {
    let id = 0;
    const service = createCurrencyWarGameService({
      store: memoryStore(),
      catalog,
      idFactory: () => `game-${++id}`,
    });

    const first = (await service.initialize()).games[0];
    expect(first.name).toBe("对局 1");
    const second = await service.create();
    expect(second.name).toBe("对局 2");
    expect((await service.create()).name).toBe("对局 3");

    await service.remove(second.gameId);
    expect((await service.create()).name).toBe("对局 2");
  });

  it("does not reserve automatic numbers for custom names", async () => {
    const service = createCurrencyWarGameService({
      store: memoryStore(),
      catalog,
    });
    await service.initialize();

    expect((await service.create("追击队")).name).toBe("追击队");
    expect((await service.create()).name).toBe("对局 2");
  });

  it("creates one initial game and enforces the ten-game limit", async () => {
    let id = 0;
    const service = createCurrencyWarGameService({
      store: memoryStore(),
      catalog,
      idFactory: () => `game-${++id}`,
    });
    expect((await service.initialize()).games).toHaveLength(1);
    for (let index = 1; index < 10; index += 1) await service.create();
    await expect(service.create()).rejects.toThrow("CURRENCY_WAR_GAME_LIMIT_REACHED");
  });

  it("renames, switches, removes, and recreates the final game", async () => {
    let id = 0;
    const service = createCurrencyWarGameService({
      store: memoryStore(),
      catalog,
      idFactory: () => `game-${++id}`,
    });
    const initialized = await service.initialize();
    const firstId = initialized.activeGameId;
    const second = await service.create("第二局");
    await service.setActive(firstId);
    expect((await service.rename(firstId, " 第一局 ")).name).toBe("第一局");
    await service.remove(firstId);
    expect((await service.list()).activeGameId).toBe(second.gameId);
    await service.remove(second.gameId);
    expect((await service.list()).games).toHaveLength(1);
  });

  it("does not save an invalid update", async () => {
    const service = createCurrencyWarGameService({ store: memoryStore(), catalog });
    const { activeGameId } = await service.initialize();
    const result = await service.update(activeGameId, { nodeId: "missing" });
    expect(result.saved).toBe(false);
    expect((await service.get(activeGameId)).nodeId).toBe("1-1");
  });
});
