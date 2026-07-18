import type { AgentEvent } from "../agent/agent-events.js";

export type ToolSource = "builtin" | "skill" | "mcp";

export interface ToolMetadata {
  source: ToolSource;
  ownerId?: string;
  originalName?: string;
  risk?: "read" | "sensitive";
}

export interface JsonSchema {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: Array<string | number | boolean | null>;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}

export type JsonSchemaProperty = JsonSchema;

export interface ToolParameters extends JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
}

export interface ToolDefinition {
  id: string;
  description: string;
  parameters: ToolParameters;
  enabled: boolean;
  metadata?: ToolMetadata;
  execute(args: Record<string, unknown>, context?: ToolExecutionContext): Promise<string>;
}

export interface ToolExecutionContext {
  runState: Map<string, unknown>;
  emitEvent: (event: AgentEvent) => void;
  executionMode?: "interactive" | "scheduled";
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: ToolParameters;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolExecutionResult {
  toolCall: ToolCall;
  output: string;
}
