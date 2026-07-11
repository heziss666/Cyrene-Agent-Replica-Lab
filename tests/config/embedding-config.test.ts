import { describe, expect, it } from "vitest";
import { loadEmbeddingConfig } from "../../src/main/config/embedding-config.js";

describe("loadEmbeddingConfig", () => {
  it("uses the Phase 6B Ollama defaults", () => {
    expect(loadEmbeddingConfig({})).toEqual({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3-embedding:4b",
      requestTimeoutMs: 120_000,
    });
  });

  it("reads environment overrides and removes a trailing slash", () => {
    expect(
      loadEmbeddingConfig({
        CYRENE_EMBEDDING_PROVIDER: "ollama",
        CYRENE_OLLAMA_BASE_URL: "http://localhost:9999/",
        CYRENE_EMBEDDING_MODEL: "custom-embedding",
        CYRENE_EMBEDDING_TIMEOUT_MS: "45000",
      }),
    ).toEqual({
      provider: "ollama",
      baseUrl: "http://localhost:9999",
      model: "custom-embedding",
      requestTimeoutMs: 45_000,
    });
  });

  it("rejects unsupported providers and invalid timeouts", () => {
    expect(() =>
      loadEmbeddingConfig({ CYRENE_EMBEDDING_PROVIDER: "cloud" }),
    ).toThrow("Unsupported embedding provider: cloud");

    expect(() =>
      loadEmbeddingConfig({ CYRENE_EMBEDDING_TIMEOUT_MS: "zero" }),
    ).toThrow("CYRENE_EMBEDDING_TIMEOUT_MS must be a positive integer");
  });
});
