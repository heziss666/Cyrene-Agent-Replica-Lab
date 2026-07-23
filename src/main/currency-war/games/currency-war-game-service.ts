import { randomUUID } from "node:crypto";
import type {
  CurrencyWarEditorOptions,
  CurrencyWarGameListResult,
  CurrencyWarGameState,
  CurrencyWarStatePatch,
  CurrencyWarStateUpdateResult,
  CurrencyWarStateValidationResult,
} from "../../../shared/currency-war-api-types.js";
import type { CurrencyWarCatalog } from "../data/currency-war-catalog.js";
import { createDefaultGameState } from "../state/game-state-factory.js";
import { validateGameState } from "../state/game-state-validator.js";
import type { CurrencyWarGameStore } from "./currency-war-game-store.js";
import { buildCurrencyWarGameSummary } from "./currency-war-game-summary.js";

export const MAX_CURRENCY_WAR_GAMES = 10;

export interface CurrencyWarGameService {
  initialize(): Promise<CurrencyWarGameListResult>;
  list(): Promise<CurrencyWarGameListResult>;
  get(gameId: string): Promise<CurrencyWarGameState>;
  create(name?: string): Promise<CurrencyWarGameState>;
  setActive(gameId: string): Promise<CurrencyWarGameState>;
  rename(gameId: string, name: string): Promise<CurrencyWarGameState>;
  update(gameId: string, patch: CurrencyWarStatePatch): Promise<CurrencyWarStateUpdateResult>;
  reset(gameId: string): Promise<CurrencyWarGameState>;
  remove(gameId: string): Promise<CurrencyWarGameListResult>;
  validate(gameId: string): Promise<CurrencyWarStateValidationResult>;
  summarize(gameId: string): Promise<string>;
  getEditorOptions(): CurrencyWarEditorOptions;
  flush(): Promise<void>;
}

export function createCurrencyWarGameService(options: {
  store: CurrencyWarGameStore;
  catalog: CurrencyWarCatalog;
  idFactory?: () => string;
  now?: () => string;
}): CurrencyWarGameService {
  const idFactory = options.idFactory ?? (() => `game_${randomUUID()}`);
  const now = options.now ?? (() => new Date().toISOString());

  const get = async (gameId: string) => {
    const state = await options.store.load(gameId);
    if (!state) throw new Error("CURRENCY_WAR_GAME_NOT_FOUND");
    return structuredClone(state);
  };
  const create = async (name = "新对局") => {
    if ((await options.store.list()).length >= MAX_CURRENCY_WAR_GAMES) {
      throw new Error("CURRENCY_WAR_GAME_LIMIT_REACHED");
    }
    const state = createDefaultGameState(idFactory(), normalizeName(name), now());
    await options.store.save(state);
    await options.store.setActive(state.gameId);
    return structuredClone(state);
  };
  const list = async (): Promise<CurrencyWarGameListResult> => {
    const games = await options.store.list();
    const activeGameId = await options.store.getActiveId();
    if (!activeGameId) throw new Error("CURRENCY_WAR_GAME_NOT_FOUND");
    return { activeGameId, games, maxGames: MAX_CURRENCY_WAR_GAMES };
  };

  return {
    async initialize() {
      await options.store.initialize();
      if ((await options.store.list()).length === 0) await create();
      return list();
    },
    list,
    get,
    create,
    async setActive(gameId) {
      await options.store.setActive(gameId);
      return get(gameId);
    },
    async rename(gameId, name) {
      const state = await get(gameId);
      const candidate = { ...state, name: normalizeName(name), updatedAt: now() };
      await options.store.save(candidate);
      return structuredClone(candidate);
    },
    async update(gameId, patch) {
      const current = await get(gameId);
      const { name: _ignoredName, ...editablePatch } = structuredClone(patch);
      const candidate: CurrencyWarGameState = { ...current, ...editablePatch, updatedAt: now() };
      const validation = validateGameState(candidate, options.catalog);
      if (!validation.valid) {
        return { state: current, saved: false, valid: false, issues: validation.issues };
      }
      await options.store.save(candidate);
      return { state: structuredClone(candidate), saved: true, valid: true, issues: validation.issues };
    },
    async reset(gameId) {
      const current = await get(gameId);
      const state = createDefaultGameState(gameId, current.name, now());
      await options.store.save(state);
      return structuredClone(state);
    },
    async remove(gameId) {
      await get(gameId);
      await options.store.remove(gameId);
      if ((await options.store.list()).length === 0) await create();
      return list();
    },
    async validate(gameId) {
      const result = validateGameState(await get(gameId), options.catalog);
      return { valid: result.valid, issues: result.issues };
    },
    async summarize(gameId) {
      const state = await get(gameId);
      const result = validateGameState(state, options.catalog);
      if (!result.valid) throw new Error("CURRENCY_WAR_GAME_INVALID");
      return buildCurrencyWarGameSummary(state);
    },
    getEditorOptions() {
      const characters = options.catalog.list("characters").map((entity) => ({
        name: entity.name,
        costs: normalizeCosts(entity.cost),
        advisor: entity.advisor !== false && entity.advisor !== null,
      })).sort((left, right) =>
        (left.costs[0] ?? 999) - (right.costs[0] ?? 999) || left.name.localeCompare(right.name, "zh-CN")
      );
      const equipment = options.catalog.list("equipment").map(({ name }) => name)
        .sort((left, right) => left.localeCompare(right, "zh-CN"));
      return structuredClone({ characters, equipment });
    },
    flush: () => options.store.flush(),
  };
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 60) throw new Error("CURRENCY_WAR_GAME_NAME_INVALID");
  return name;
}

function normalizeCosts(value: unknown): number[] {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.filter((item): item is number =>
    typeof item === "number" && Number.isInteger(item) && item > 0
  ))].sort((left, right) => left - right);
}
