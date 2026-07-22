import { createCurrencyWarCatalog, type CurrencyWarCatalog } from "./data/currency-war-catalog.js";
import type { CurrencyWarRuntimeSnapshot } from "./data/currency-war-runtime-loader.js";

export interface CurrencyWarDataHealth {
  investmentEnvironmentsAvailable: boolean;
  economyRulesAvailable: boolean;
}

export interface CurrencyWarRuntime {
  gameVersion: string;
  catalog: CurrencyWarCatalog;
  dataHealth: CurrencyWarDataHealth;
}

export function createCurrencyWarRuntime(snapshot: CurrencyWarRuntimeSnapshot): CurrencyWarRuntime {
  return {
    gameVersion: snapshot.gameVersion,
    catalog: createCurrencyWarCatalog(snapshot),
    dataHealth: {
      investmentEnvironmentsAvailable: snapshot.investmentEnvironments.length > 0,
      // Economy rules are intentionally outside the first compact data snapshot.
      economyRulesAvailable: false,
    },
  };
}
