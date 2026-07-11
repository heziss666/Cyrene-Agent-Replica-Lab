import { createDefaultKnowledgeBase } from "../rag/default-knowledge.js";
import type { EmbeddingProvider } from "../rag/embedding-provider.js";
import { ToolRegistry } from "./tool-registry.js";
import type { ToolDefinition } from "./tool-types.js";

export interface CreateDefaultToolRegistryOptions {
  embeddingProvider?: EmbeddingProvider;
}

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

export function createDefaultToolRegistry(
  options: CreateDefaultToolRegistryOptions = {},
): ToolRegistry {
  const knowledgeBase = createDefaultKnowledgeBase(options.embeddingProvider);
  const registry = new ToolRegistry();
  const searchKnowledgeTool: ToolDefinition = {
    id: "search_knowledge",
    description: "Search the local knowledge base for relevant text snippets.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query describing what knowledge to retrieve.",
        },
        topK: {
          type: "number",
          description: "Maximum number of snippets to return.",
        },
      },
      required: ["query"],
    },
    enabled: true,
    execute: async (args) => {
      const query = stringifyArg(args.query).trim();
      const topK = typeof args.topK === "number" ? args.topK : 5;
      const response = await knowledgeBase.search(query, topK);
      const header = [
        `retrieval_mode: ${response.mode}`,
        response.model ? `embedding_model: ${response.model}` : undefined,
        response.warning ? `warning: ${response.warning}` : undefined,
      ].filter((line): line is string => Boolean(line));

      if (response.results.length === 0) {
        return [...header, "No matching knowledge found."].join("\n");
      }

      const snippets = response.results.map((result, index) =>
        [
          `[${index + 1}] ${result.chunk.title}`,
          `source: ${result.chunk.source}`,
          `score: ${result.score}`,
          result.matchedTerms
            ? `matched_terms: ${result.matchedTerms.join(", ")}`
            : undefined,
          "content:",
          result.chunk.text,
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n"),
      );

      return [...header, "", ...snippets].join("\n");
    },
  };

  registry.register(getCurrentTimeTool);
  registry.register(calculatorTool);
  registry.register(echoTool);
  registry.register(searchKnowledgeTool);
  return registry;
}
