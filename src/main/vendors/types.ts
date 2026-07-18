import type { ChatMessage } from "../../shared/chat-types.js";
import type { ModelConfig } from "../config/model-config.js";
import type { ToolCall, ToolExecutionResult, ToolSpec } from "../tools/tool-types.js";

export interface ChatCompletionInput {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: "auto" | "required";
}

export interface VendorHttpRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface ChatCompletionResult {
  assistantMessage: ChatMessage;
  text: string;
  finishReason: string;
  toolCalls: ToolCall[];
  usage?: {
    input: number;
    output: number;
  };
}

export interface VendorAdapter {
  readonly id: string;
  buildRequest(input: ChatCompletionInput, config: ModelConfig): VendorHttpRequest;
  parseResponse(data: unknown): ChatCompletionResult;
  appendToolResults(
    messages: ChatMessage[],
    results: ToolExecutionResult[],
  ): ChatMessage[];
}
