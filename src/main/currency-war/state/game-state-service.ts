import type {
  CurrencyWarGameState,
  CurrencyWarStatePatch,
  CurrencyWarStateUpdateResult,
  CurrencyWarStateValidationResult,
  CurrencyWarEditorOptions,
} from "../../../shared/currency-war-api-types.js";
import type { CurrencyWarCatalog } from "../data/currency-war-catalog.js";
import { buildCurrencyWarAgentContext } from "./game-state-agent-context.js";
import { createDefaultGameState } from "./game-state-factory.js";
import type { CurrencyWarGameStateStore } from "./game-state-store.js";
import { validateGameState } from "./game-state-validator.js";

export interface CurrencyWarGameStateService {
  get(conversationId: string): Promise<CurrencyWarGameState>;
  create(conversationId: string): Promise<CurrencyWarGameState>;
  update(conversationId: string, patch: CurrencyWarStatePatch): Promise<CurrencyWarStateUpdateResult>;
  reset(conversationId: string): Promise<CurrencyWarGameState>;
  remove(conversationId: string): Promise<void>;
  validate(conversationId: string): Promise<CurrencyWarStateValidationResult>;
  getAgentContext(conversationId: string): Promise<string>;
  flush(): Promise<void>;
  getEditorOptions(): CurrencyWarEditorOptions;
}

export function createCurrencyWarGameStateService(options: {
  store: CurrencyWarGameStateStore;
  catalog: CurrencyWarCatalog;
  now?: () => string;
}): CurrencyWarGameStateService {
  const now = options.now ?? (() => new Date().toISOString());

  async function createAndSave(conversationId: string): Promise<CurrencyWarGameState> {
    const state = createDefaultGameState(conversationId, now());
    await options.store.save(state);
    return structuredClone(state);
  }

  return {
    async get(conversationId) {
      return await options.store.load(conversationId) ?? createAndSave(conversationId);
    },

    async create(conversationId) {
      return await options.store.load(conversationId) ?? createAndSave(conversationId);
    },

    async update(conversationId, patch) {
      const current = await this.get(conversationId);
      const candidate: CurrencyWarGameState = {
        ...current,
        ...structuredClone(patch),
        updatedAt: now(),
      };
      const validation = validateGameState(candidate, options.catalog);
      if (!validation.valid) {
        return { state: current, saved: false, valid: false, issues: validation.issues };
      }
      await options.store.save(candidate);
      return { state: structuredClone(candidate), saved: true, valid: true, issues: validation.issues };
    },

    async reset(conversationId) {
      const state = createDefaultGameState(conversationId, now());
      await options.store.save(state);
      return structuredClone(state);
    },

    remove: (conversationId) => options.store.remove(conversationId),

    async validate(conversationId) {
      const state = await this.get(conversationId);
      const result = validateGameState(state, options.catalog);
      return { valid: result.valid, issues: result.issues };
    },

    async getAgentContext(conversationId) {
      const state = await this.get(conversationId);
      const result = validateGameState(state, options.catalog);
      return buildCurrencyWarAgentContext(state, result.issues);
    },

    flush: () => options.store.flush(),

    getEditorOptions() {
      const characters = options.catalog.list("characters").map((entity) => ({
        name: entity.name,
        costs: normalizeCosts(entity.cost),
        advisor: entity.advisor !== false && entity.advisor !== null,
      })).sort((left, right) =>
        (left.costs[0] ?? 999) - (right.costs[0] ?? 999)
        || left.name.localeCompare(right.name, "zh-CN")
      );
      const equipment = options.catalog.list("equipment")
        .map(({ name }) => name)
        .sort((left, right) => left.localeCompare(right, "zh-CN"));
      return structuredClone({ characters, equipment });
    },
  };
}

function normalizeCosts(value: unknown): number[] {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.filter((item): item is number =>
    typeof item === "number" && Number.isInteger(item) && item > 0
  ))].sort((left, right) => left - right);
}
