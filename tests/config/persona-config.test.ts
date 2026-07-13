import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPersonaConfig,
  savePersonaConfig,
} from "../../src/main/config/persona-config.js";

const directories: string[] = [];

function createPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "cyrene-persona-config-"));
  directories.push(directory);
  return join(directory, "persona.json");
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadPersonaConfig", () => {
  it("returns default without warning when the file does not exist", async () => {
    const logger = vi.fn();

    await expect(loadPersonaConfig(createPath(), logger)).resolves.toEqual({ styleId: "default" });
    expect(logger).not.toHaveBeenCalled();
  });

  it("loads a valid versioned style config", async () => {
    const path = createPath();
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, styleId: "healing" }), "utf8");

    await expect(loadPersonaConfig(path)).resolves.toEqual({ styleId: "healing" });
  });

  it.each([
    ["invalid JSON", "{"],
    ["invalid schema", JSON.stringify({ schemaVersion: 2, styleId: "default" })],
    ["invalid style", JSON.stringify({ schemaVersion: 1, styleId: "phone" })],
  ])("warns and falls back for %s", async (_label, content) => {
    const path = createPath();
    const logger = vi.fn();
    writeFileSync(path, content, "utf8");

    await expect(loadPersonaConfig(path, logger)).resolves.toEqual({ styleId: "default" });
    expect(logger).toHaveBeenCalledWith(expect.stringContaining("persona config"));
  });
});

describe("savePersonaConfig", () => {
  it("atomically saves formatted versioned JSON", async () => {
    const path = createPath();

    await savePersonaConfig(path, { styleId: "focused" });

    expect(readFileSync(path, "utf8")).toBe(
      '{\n  "schemaVersion": 1,\n  "styleId": "focused"\n}\n',
    );
  });
});
