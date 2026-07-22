import { createCurrencyWarRuntime } from "../main/currency-war/currency-war-runtime.js";
import { loadCurrencyWarRuntime } from "../main/currency-war/data/currency-war-runtime-loader.js";

interface DataCheckOptions {
  runtimeDir?: string;
  gameVersion?: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const snapshot = await loadCurrencyWarRuntime(options);
  const runtime = createCurrencyWarRuntime(snapshot);

  console.log(`Currency War runtime: ${runtime.gameVersion}`);
  console.log(`characters: ${snapshot.datasets.characters.records.length}`);
  console.log(`bonds: ${snapshot.datasets.bonds.records.length}`);
  console.log(`equipment: ${snapshot.datasets.equipment.records.length}`);
  console.log(`investment strategies: ${snapshot.datasets.investment_strategies.records.length}`);
  console.log(`investment environments available: ${snapshot.datasets.investment_environments.records.length}`);
  console.log(`game rules complete: ${runtime.dataHealth.gameRulesComplete}`);
}

function parseArgs(args: string[]): DataCheckOptions {
  const options: DataCheckOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === "--runtime-dir" && value) {
      options.runtimeDir = value;
      index += 1;
    } else if (argument === "--game-version" && value) {
      options.gameVersion = value;
      index += 1;
    } else {
      throw new Error("CURRENCY_WAR_DATA_CHECK_INVALID_ARGUMENT");
    }
  }
  return options;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "CURRENCY_WAR_DATA_CHECK_FAILED";
  console.error(message);
  process.exitCode = 1;
});
