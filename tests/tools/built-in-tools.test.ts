import { describe, expect, it } from "vitest";
import { createDefaultToolRegistry } from "../../src/main/tools/built-in-tools.js";

describe("createDefaultToolRegistry", () => {
  it("registers the default safe tools", () => {
    const registry = createDefaultToolRegistry();

    expect(registry.getEnabledTools().map((tool) => tool.id)).toEqual([
      "get_current_time",
      "calculator",
      "echo",
    ]);
  });

  it("echoes text", async () => {
    const tool = createDefaultToolRegistry().getById("echo");

    await expect(tool?.execute({ text: "hello tools" })).resolves.toBe("hello tools");
  });

  it("calculates a simple arithmetic expression", async () => {
    const tool = createDefaultToolRegistry().getById("calculator");

    await expect(tool?.execute({ expression: "2 + 3 * (4 - 1)" })).resolves.toBe("11");
  });

  it("rejects unsafe calculator expressions", async () => {
    const tool = createDefaultToolRegistry().getById("calculator");

    await expect(tool?.execute({ expression: "process.exit()" })).resolves.toContain(
      "[error]",
    );
  });

  it("returns the current time as an ISO string", async () => {
    const tool = createDefaultToolRegistry().getById("get_current_time");
    const output = await tool?.execute({});

    expect(output).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(Number.isNaN(Date.parse(output ?? ""))).toBe(false);
  });
});
