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
  console.log(`characters: ${snapshot.characters.length}`);
  console.log(`bonds: ${snapshot.bonds.length}`);
  console.log(`equipment: ${snapshot.equipment.length}`);
  console.log(`investment strategies: ${snapshot.investmentStrategies.length}`);
  console.log(`investment environments: ${snapshot.investmentEnvironments.length}`);
  console.log(`economy rules available: ${runtime.dataHealth.economyRulesAvailable}`);
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
