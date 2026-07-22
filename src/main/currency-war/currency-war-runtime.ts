import { createCurrencyWarCatalog, type CurrencyWarCatalog } from "./data/currency-war-catalog.js";
import type { CurrencyWarRuntimeSnapshot } from "./data/currency-war-runtime-loader.js";

export interface CurrencyWarDataHealth {
  investmentEnvironmentsAvailable: boolean;
  gameRulesComplete: boolean;
}

export interface CurrencyWarRuntime {
  gameVersion: string;
  catalog: CurrencyWarCatalog;
  dataHealth: CurrencyWarDataHealth;
}

export function createCurrencyWarRuntime(snapshot: CurrencyWarRuntimeSnapshot): CurrencyWarRuntime {
  const economy = snapshot.gameRules.economy;
  const population = snapshot.gameRules.population;
  const shop = snapshot.gameRules.shop;

  return {
    gameVersion: snapshot.gameVersion,
    catalog: createCurrencyWarCatalog(snapshot),
    dataHealth: {
      investmentEnvironmentsAvailable: snapshot.datasets.investment_environments.records.length > 0,
      gameRulesComplete: economy.shop_refresh_cost !== null
        && hasRecords(economy.interest_rules)
        && hasRecords(population.levels)
        && hasRecords(shop.odds_by_level),
    },
  };
}

function hasRecords(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}
