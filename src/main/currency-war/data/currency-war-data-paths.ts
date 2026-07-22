import { fileURLToPath } from "node:url";

export function defaultCurrencyWarRuntimeDir(gameVersion = "4.4"): string {
  return fileURLToPath(
    new URL(`../../../../data/currency-war/runtime/${gameVersion}/`, import.meta.url),
  );
}
