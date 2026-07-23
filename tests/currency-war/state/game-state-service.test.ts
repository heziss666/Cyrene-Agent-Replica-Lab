import { describe, expect, it } from "vitest";
import type { CurrencyWarGameState } from "../../../src/shared/currency-war-api-types.js";
import type { CurrencyWarCatalog } from "../../../src/main/currency-war/data/currency-war-catalog.js";
import type { CurrencyWarGameStateStore } from "../../../src/main/currency-war/state/game-state-store.js";
import { createCurrencyWarGameStateService } from "../../../src/main/currency-war/state/game-state-service.js";

function setup() {
  const records = new Map<string, CurrencyWarGameState>();
  const store: CurrencyWarGameStateStore = {
    initialize: async () => undefined,
    load: async (id) => structuredClone(records.get(id) ?? null),
    save: async (state) => { records.set(state.conversationId, structuredClone(state)); },
    remove: async (id) => { records.delete(id); },
    flush: async () => undefined,
  };
  const catalog = {
    getByName: () => undefined,
    findByName: () => [],
    getRelated: () => [],
    list: () => [],
  } satisfies CurrencyWarCatalog;
  const service = createCurrencyWarGameStateService({
    store,
    catalog,
    now: () => "2026-07-23T00:00:00.000Z",
  });
  return { service, records };
}

describe("CurrencyWarGameStateService", () => {
  it("builds compact editor options from single-cost and multi-cost catalog characters", async () => {
    const records = new Map<string, CurrencyWarGameState>();
    const store: CurrencyWarGameStateStore = {
      initialize: async () => undefined,
      load: async (id) => records.get(id) ?? null,
      save: async (state) => { records.set(state.conversationId, state); },
      remove: async () => undefined,
      flush: async () => undefined,
    };
    const catalog = {
      getByName: () => undefined,
      findByName: () => [],
      getRelated: () => [],
      list: (type: string) => type === "characters" ? [
        { name: "角色B", cost: [3, 2, 2], advisor: true },
        { name: "角色A", cost: 1, advisor: false },
      ] : type === "equipment" ? [{ name: "装备A" }] : [],
    } as unknown as CurrencyWarCatalog;
    const service = createCurrencyWarGameStateService({ store, catalog });

    expect(service.getEditorOptions()).toEqual({
      characters: [
        { name: "角色A", costs: [1], advisor: false },
        { name: "角色B", costs: [2, 3], advisor: true },
      ],
      equipment: ["装备A"],
    });
  });

  it("creates a missing state and returns the persisted state afterward", async () => {
    const { service, records } = setup();
    expect(await service.get("conversation-1")).toMatchObject({ nodeId: "1-1" });
    expect(records.has("conversation-1")).toBe(true);
  });

  it("saves a valid patch and rejects an invalid patch without changing disk state", async () => {
    const { service, records } = setup();
    await service.create("conversation-1");
    expect(await service.update("conversation-1", { gold: 20 })).toMatchObject({ saved: true, state: { gold: 20 } });

    const rejected = await service.update("conversation-1", { level: -1 });
    expect(rejected).toMatchObject({ saved: false, valid: false });
    expect(records.get("conversation-1")?.level).toBe(1);
  });

  it("resets and removes one conversation", async () => {
    const { service, records } = setup();
    await service.create("conversation-1");
    await service.update("conversation-1", { gold: 20 });
    expect((await service.reset("conversation-1")).gold).toBe(0);
    await service.remove("conversation-1");
    expect(records.has("conversation-1")).toBe(false);
  });
});
