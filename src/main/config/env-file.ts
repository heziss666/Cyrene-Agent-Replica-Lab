import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface LoadLocalEnvFileOptions {
  envFilePath?: string;
  env?: NodeJS.ProcessEnv;
}

export interface LoadLocalEnvFileResult {
  loaded: boolean;
  path: string;
}

function stripOptionalQuotes(value: string): string {
  const first = value[0];
  const last = value[value.length - 1];

  if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
    return value.slice(1, -1);
  }

  return value;
}

function parseEnvLine(line: string): [string, string] | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }

  const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const separatorIndex = normalized.indexOf("=");
  if (separatorIndex === -1) {
    return undefined;
  }

  const key = normalized.slice(0, separatorIndex).trim();
  const value = stripOptionalQuotes(normalized.slice(separatorIndex + 1).trim());
  return key ? [key, value] : undefined;
}

export function loadLocalEnvFile(
  options: LoadLocalEnvFileOptions = {},
): LoadLocalEnvFileResult {
  const envFilePath = resolve(options.envFilePath ?? ".env");
  const env = options.env ?? process.env;

  if (!existsSync(envFilePath)) {
    return { loaded: false, path: envFilePath };
  }

  const content = readFileSync(envFilePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;

    const [key, value] = parsed;
    if (env[key] === undefined) {
      env[key] = value;
    }
  }

  return { loaded: true, path: envFilePath };
}
