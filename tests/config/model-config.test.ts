import { describe, expect, it } from "vitest";
import { loadModelConfig } from "../../src/main/config/model-config.js";

describe("loadModelConfig", () => {
  it("loads explicit environment values", () => {
    const config = loadModelConfig({
      CYRENE_MODEL_PROVIDER: "deepseek",
      CYRENE_MODEL_BASE_URL: "https://api.deepseek.com",
      CYRENE_MODEL_NAME: "deepseek-chat",
      CYRENE_MODEL_API_KEY: "sk-test",
    });

    expect(config).toEqual({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "sk-test",
    });
  });

  it("uses safe defaults except for the API key", () => {
    const config = loadModelConfig({
      CYRENE_MODEL_API_KEY: "sk-test",
    });

    expect(config.provider).toBe("deepseek");
    expect(config.baseUrl).toBe("https://api.deepseek.com");
    expect(config.model).toBe("deepseek-chat");
    expect(config.apiKey).toBe("sk-test");
  });

  it("throws when the API key is missing", () => {
    expect(() => loadModelConfig({})).toThrow("CYRENE_MODEL_API_KEY is required");
  });
});
