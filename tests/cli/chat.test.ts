import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createInitialHistory,
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

describe("createInitialHistory", () => {
  it("starts the CLI conversation with one system message", () => {
    expect(createInitialHistory()).toEqual([
      {
        role: "system",
        content: [
          "You are Cyrene Replica Lab, a minimal learning agent.",
          "Answer clearly and briefly.",
          "When explaining technical ideas, use beginner-friendly wording.",
        ].join("\n"),
      },
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
