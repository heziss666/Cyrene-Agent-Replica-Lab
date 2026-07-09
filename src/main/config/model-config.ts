export interface ModelConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string {
  return typeof env[key] === "string" ? env[key]!.trim() : "";
}

export function loadModelConfig(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const apiKey = readEnv(env, "CYRENE_MODEL_API_KEY");
  if (!apiKey) {
    throw new Error("CYRENE_MODEL_API_KEY is required");
  }

  return {
    provider: readEnv(env, "CYRENE_MODEL_PROVIDER") || "deepseek",
    baseUrl: readEnv(env, "CYRENE_MODEL_BASE_URL") || "https://api.deepseek.com",
    model: readEnv(env, "CYRENE_MODEL_NAME") || "deepseek-chat",
    apiKey,
  };
}
