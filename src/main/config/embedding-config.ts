export interface EmbeddingConfig {
  provider: "ollama";
  baseUrl: string;
  model: string;
  requestTimeoutMs: number;
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string {
  return typeof env[key] === "string" ? env[key]!.trim() : "";
}

function removeTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

export function loadEmbeddingConfig(
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingConfig {
  const provider = readEnv(env, "CYRENE_EMBEDDING_PROVIDER") || "ollama";
  if (provider !== "ollama") {
    throw new Error(`Unsupported embedding provider: ${provider}`);
  }

  const timeoutText = readEnv(env, "CYRENE_EMBEDDING_TIMEOUT_MS");
  const requestTimeoutMs = timeoutText ? Number(timeoutText) : 120_000;
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error("CYRENE_EMBEDDING_TIMEOUT_MS must be a positive integer");
  }

  return {
    provider,
    baseUrl: removeTrailingSlashes(
      readEnv(env, "CYRENE_OLLAMA_BASE_URL") || "http://127.0.0.1:11434",
    ),
    model: readEnv(env, "CYRENE_EMBEDDING_MODEL") || "qwen3-embedding:4b",
    requestTimeoutMs,
  };
}
