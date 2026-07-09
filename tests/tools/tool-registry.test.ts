import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../../src/main/tools/tool-registry.js";
import type { ToolDefinition } from "../../src/main/tools/tool-types.js";

function createTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "echo",
    description: "Echo text back to the caller.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to echo." },
      },
      required: ["text"],
    },
    enabled: true,
    execute: async (args) => String(args.text ?? ""),
    ...overrides,
  };
}

describe("ToolRegistry", () => {
  it("registers and finds a tool by id", () => {
    const registry = new ToolRegistry();
    const tool = createTool();

    registry.register(tool);

    expect(registry.getById("echo")).toBe(tool);
  });

  it("lists only enabled tools", () => {
    const registry = new ToolRegistry();
    registry.register(createTool({ id: "enabled_tool", enabled: true }));
    registry.register(createTool({ id: "disabled_tool", enabled: false }));

    expect(registry.getEnabledTools().map((tool) => tool.id)).toEqual(["enabled_tool"]);
  });

  it("allows a registered tool to be disabled", () => {
    const registry = new ToolRegistry();
    registry.register(createTool({ id: "echo", enabled: true }));

    registry.setEnabled("echo", false);

    expect(registry.getEnabledTools()).toEqual([]);
  });
});
