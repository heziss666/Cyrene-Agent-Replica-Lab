import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildModelMessages,
  createRuntimePromptComposer,
  createRuntimeToolRegistry,
  loadRuntimeModelConfig,
} from "../../src/main/runtime/agent-runtime.js";

const originalCwd = process.cwd();
const originalApiKey = process.env.CYRENE_MODEL_API_KEY;
const originalEmbeddingModel = process.env.CYRENE_EMBEDDING_MODEL;

afterEach(() => {
  process.chdir(originalCwd);
  if (originalApiKey === undefined) delete process.env.CYRENE_MODEL_API_KEY;
  else process.env.CYRENE_MODEL_API_KEY = originalApiKey;
  if (originalEmbeddingModel === undefined) delete process.env.CYRENE_EMBEDDING_MODEL;
  else process.env.CYRENE_EMBEDDING_MODEL = originalEmbeddingModel;
});

describe("agent runtime", () => {
  it("creates the shared prompt composer and prepends one system message", () => {
    const prompt = createRuntimePromptComposer().composeSystemPrompt({ styleId: "default" });
    expect(prompt).toContain("\n\n---\n\n");
    expect(buildModelMessages(prompt, [{ role: "user", content: "hello" }])).toEqual([
      { role: "system", content: prompt },
      { role: "user", content: "hello" },
    ]);
  });

  it("resolves prompt resources independently from the current working directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyrene-runtime-prompt-"));
    try {
      process.chdir(directory);
      const prompt = createRuntimePromptComposer().composeSystemPrompt({ styleId: "healing" });
      expect(prompt).toContain("\n\n---\n\n");
    } finally {
      process.chdir(originalCwd);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("loads model config from a local env file", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyrene-runtime-env-"));
    try {
      delete process.env.CYRENE_MODEL_API_KEY;
      writeFileSync(join(directory, ".env"), "CYRENE_MODEL_API_KEY=sk-from-runtime-env\n");
      process.chdir(directory);
      expect(loadRuntimeModelConfig().apiKey).toBe("sk-from-runtime-env");
    } finally {
      process.chdir(originalCwd);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("creates the default tool registry after loading local embedding settings", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyrene-runtime-tools-"));
    try {
      delete process.env.CYRENE_EMBEDDING_MODEL;
      writeFileSync(join(directory, ".env"), "CYRENE_EMBEDDING_MODEL=runtime-test-model\n");
      process.chdir(directory);
      const registry = createRuntimeToolRegistry();
      expect(registry.getEnabledTools().map((tool) => tool.id)).toEqual([
        "get_current_time",
        "calculator",
        "echo",
        "search_knowledge",
      ]);
      expect(process.env.CYRENE_EMBEDDING_MODEL).toBe("runtime-test-model");
    } finally {
      process.chdir(originalCwd);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("adds progressive skill tools when a skill registry is supplied", () => {
    const registry = createRuntimeToolRegistry({
      get: () => undefined,
      readBody: async () => "body",
      readReference: async () => "reference",
    });

    expect(registry.getEnabledTools().map((tool) => tool.id)).toEqual([
      "get_current_time",
      "calculator",
      "echo",
      "search_knowledge",
      "invoke_skill",
      "read_skill_reference",
    ]);
  });
});
