import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tsxCliPath = fileURLToPath(new URL("../../../node_modules/tsx/dist/cli.mjs", import.meta.url));
const cliPath = fileURLToPath(new URL("../../../src/cli/currency-war-data-check.ts", import.meta.url));
const fixtureRuntimeDir = fileURLToPath(new URL("fixtures/runtime-4.4/", import.meta.url));

describe("currency-war:data-check CLI", () => {
  it("prints a concise, non-zero data health report", async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      tsxCliPath,
      cliPath,
      "--runtime-dir",
      fixtureRuntimeDir,
    ]);

    expect(stderr).toBe("");
    expect(stdout).toContain("Currency War runtime: 4.4");
    expect(stdout).toContain("characters: 1");
    expect(stdout).toContain("bonds: 1");
    expect(stdout).toContain("investment environments: 1");
    expect(stdout).toContain("economy rules available: false");
  });

  it("returns a stable error code for an invalid runtime directory", async () => {
    await expect(execFileAsync(process.execPath, [
      tsxCliPath,
      cliPath,
      "--runtime-dir",
      "does-not-exist",
    ])).rejects.toMatchObject({ stderr: expect.stringContaining("CURRENCY_WAR_SIMPLE_SCHEMA_INVALID") });
  });
});
