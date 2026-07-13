import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildModelMessages,
  createRuntimePromptComposer,
  createRuntimeToolRegistry,
  loadRuntimeModelConfig,
} from "../../src/cli/chat.js";

const originalCwd = process.cwd();
const originalApiKey = process.env.CYRENE_MODEL_API_KEY;
const originalEmbeddingModel = process.env.CYRENE_EMBEDDING_MODEL;

afterEach(() => {
  process.chdir(originalCwd);
  if (originalApiKey === undefined) {
    delete process.env.CYRENE_MODEL_API_KEY;
  } else {
    process.env.CYRENE_MODEL_API_KEY = originalApiKey;
  }
  if (originalEmbeddingModel === undefined) {
    delete process.env.CYRENE_EMBEDDING_MODEL;
  } else {
    process.env.CYRENE_EMBEDDING_MODEL = originalEmbeddingModel;
  }
});

describe("CLI persona prompt", () => {
  it("uses the shared default Cyrene persona", () => {
    const prompt = createRuntimePromptComposer().composeSystemPrompt({
      styleId: "default",
    });

    expect(prompt).toContain("昔涟");
    expect(prompt).toContain("风格：温柔");
    expect(prompt).not.toContain("disconnected keyword list");
  });

  it("resolves prompt resources independently from process.cwd", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyrene-cli-prompt-cwd-"));
    try {
      process.chdir(directory);
      expect(createRuntimePromptComposer().composeSystemPrompt({ styleId: "healing" }))
        .toContain("风格：治愈");
    } finally {
      process.chdir(originalCwd);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("prepends one system message to history for a model request", () => {
    expect(buildModelMessages("dynamic system", [
      { role: "user", content: "hello" },
    ])).toEqual([
      { role: "system", content: "dynamic system" },
      { role: "user", content: "hello" },
    ]);
  });
});

describe("loadRuntimeModelConfig", () => {
  it("loads model config from a local .env file", () => {
    const dir = mkdtempSync(join(tmpdir(), "cyrene-cli-env-test-"));

    try {
      delete process.env.CYRENE_MODEL_API_KEY;
      writeFileSync(join(dir, ".env"), "CYRENE_MODEL_API_KEY=sk-from-cli-env\n");
      process.chdir(dir);

      expect(loadRuntimeModelConfig().apiKey).toBe("sk-from-cli-env");
    } finally {
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("createRuntimeToolRegistry", () => {
  it("creates the CLI default tool registry", () => {
    expect(createRuntimeToolRegistry().getEnabledTools().map((tool) => tool.id)).toEqual([
      "get_current_time",
      "calculator",
      "echo",
      "search_knowledge",
    ]);
  });

  it("loads embedding settings from a local .env file", () => {
    const dir = mkdtempSync(join(tmpdir(), "cyrene-cli-embedding-env-test-"));

    try {
      delete process.env.CYRENE_EMBEDDING_MODEL;
      writeFileSync(
        join(dir, ".env"),
        "CYRENE_EMBEDDING_MODEL=embedding-from-local-env\n",
      );
      process.chdir(dir);

      createRuntimeToolRegistry();

      expect(process.env.CYRENE_EMBEDDING_MODEL).toBe("embedding-from-local-env");
    } finally {
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
