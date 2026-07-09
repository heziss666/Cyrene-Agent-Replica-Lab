import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLocalEnvFile } from "../../src/main/config/env-file.js";

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "cyrene-env-test-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("loadLocalEnvFile", () => {
  it("loads key-value pairs from a .env file", () => {
    withTempDir((dir) => {
      const env: NodeJS.ProcessEnv = {};
      const envFilePath = join(dir, ".env");
      writeFileSync(
        envFilePath,
        [
          "CYRENE_MODEL_API_KEY=sk-from-env-file",
          "CYRENE_MODEL_NAME=deepseek-chat",
          "",
          "# comments are ignored",
        ].join("\n"),
      );

      const result = loadLocalEnvFile({ envFilePath, env });

      expect(result.loaded).toBe(true);
      expect(env.CYRENE_MODEL_API_KEY).toBe("sk-from-env-file");
      expect(env.CYRENE_MODEL_NAME).toBe("deepseek-chat");
    });
  });

  it("does not override values that already exist in the environment", () => {
    withTempDir((dir) => {
      const env: NodeJS.ProcessEnv = {
        CYRENE_MODEL_API_KEY: "sk-from-shell",
      };
      const envFilePath = join(dir, ".env");
      writeFileSync(envFilePath, "CYRENE_MODEL_API_KEY=sk-from-env-file\n");

      loadLocalEnvFile({ envFilePath, env });

      expect(env.CYRENE_MODEL_API_KEY).toBe("sk-from-shell");
    });
  });

  it("does nothing when the .env file does not exist", () => {
    withTempDir((dir) => {
      const env: NodeJS.ProcessEnv = {};

      const result = loadLocalEnvFile({
        envFilePath: join(dir, ".env"),
        env,
      });

      expect(result.loaded).toBe(false);
      expect(env).toEqual({});
    });
  });
});
