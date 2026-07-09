import { ToolRegistry } from "./tool-registry.js";
import type { ToolDefinition } from "./tool-types.js";

function stringifyArg(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function calculateExpression(expression: string): string {
  const trimmed = expression.trim();
  if (!trimmed) {
    return "[error] expression is required";
  }

  if (!/^[0-9+\-*/().\s]+$/.test(trimmed)) {
    return "[error] calculator only accepts numbers, spaces, +, -, *, /, and parentheses";
  }

  try {
    const result = Function(`"use strict"; return (${trimmed});`)() as unknown;
    if (typeof result !== "number" || !Number.isFinite(result)) {
      return "[error] expression did not produce a finite number";
    }
    return String(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `[error] ${message}`;
  }
}

const getCurrentTimeTool: ToolDefinition = {
  id: "get_current_time",
  description: "Return the current time as an ISO 8601 string.",
  parameters: {
    type: "object",
    properties: {},
  },
  enabled: true,
  execute: async () => new Date().toISOString(),
};

const calculatorTool: ToolDefinition = {
  id: "calculator",
  description: "Calculate a simple arithmetic expression using +, -, *, /, and parentheses.",
  parameters: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: "Arithmetic expression, for example: 2 + 3 * (4 - 1).",
      },
    },
    required: ["expression"],
  },
  enabled: true,
  execute: async (args) => calculateExpression(stringifyArg(args.expression)),
};

const echoTool: ToolDefinition = {
  id: "echo",
  description: "Return the provided text unchanged. Useful for testing tool calling.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Text to return.",
      },
    },
    required: ["text"],
  },
  enabled: true,
  execute: async (args) => stringifyArg(args.text),
};

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(getCurrentTimeTool);
  registry.register(calculatorTool);
  registry.register(echoTool);
  return registry;
}
