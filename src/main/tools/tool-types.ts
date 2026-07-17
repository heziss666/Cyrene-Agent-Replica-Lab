import type { AgentEvent } from "../agent/agent-events.js";

export type JsonSchemaProperty =
  | { type: "string"; description?: string; enum?: string[] }
  | { type: "number"; description?: string }
  | { type: "boolean"; description?: string }
  | {
      type: "array";
      description?: string;
      items: JsonSchemaProperty;
    }
  | {
      type: "object";
      description?: string;
      properties: Record<string, JsonSchemaProperty>;
      required?: string[];
    };

export interface ToolParameters {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface ToolDefinition {
  id: string;
  description: string;
  parameters: ToolParameters;
  enabled: boolean;
  execute(args: Record<string, unknown>, context?: ToolExecutionContext): Promise<string>;
}

export interface ToolExecutionContext {
  runState: Map<string, unknown>;
  emitEvent: (event: AgentEvent) => void;
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
