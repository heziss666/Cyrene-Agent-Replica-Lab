import type { VendorAdapter } from "./types.js";
import type { ChatMessage } from "../../shared/chat-types.js";
import type { ToolCall, ToolExecutionResult, ToolSpec } from "../tools/tool-types.js";

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function asResponse(data: unknown): OpenAICompatibleResponse {
  return data && typeof data === "object" ? (data as OpenAICompatibleResponse) : {};
}

function toWireMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        name: message.name,
        content: message.content,
      };
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: toolCall.arguments,
          },
        })),
      };
    }

    return {
      role: message.role,
      content: message.content,
    };
  });
}

function toWireTools(tools?: ToolSpec[]): unknown[] | undefined {
  if (!tools?.length) return undefined;

  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function parseToolCalls(response: OpenAICompatibleResponse): ToolCall[] {
  const rawToolCalls = response.choices?.[0]?.message?.tool_calls ?? [];

  return rawToolCalls.map((toolCall, index) => ({
    id: toolCall.id || `call_${index}`,
    name: toolCall.function?.name || "unknown_tool",
    arguments: toolCall.function?.arguments || "{}",
  }));
}

export const openAICompatibleAdapter: VendorAdapter = {
  id: "openai-compatible",

  buildRequest(input, config) {
    const tools = toWireTools(input.tools);
    const body: Record<string, unknown> = {
      model: config.model,
      messages: toWireMessages(input.messages),
      stream: false,
    };

    if (tools) {
      body.tools = tools;
      body.tool_choice = input.toolChoice ?? "auto";
    }

    return {
      url: `${trimTrailingSlash(config.baseUrl)}/chat/completions`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    };
  },

  parseResponse(data) {
    const response = asResponse(data);
    const firstChoice = response.choices?.[0];
    const text = firstChoice?.message?.content ?? "";
    const finishReason = firstChoice?.finish_reason ?? "unknown";
    const toolCalls = parseToolCalls(response);
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: text,
      ...(toolCalls.length ? { toolCalls } : {}),
    };
    const usage = response.usage
      ? {
          input: response.usage.prompt_tokens ?? 0,
          output: response.usage.completion_tokens ?? 0,
        }
      : undefined;

    return {
      assistantMessage,
      text,
      finishReason,
      toolCalls,
      ...(usage ? { usage } : {}),
    };
  },

  appendToolResults(messages, results) {
    const next = messages.slice();

    for (const result of results) {
      next.push({
        role: "tool",
        toolCallId: result.toolCall.id,
        name: result.toolCall.name,
        content: result.output,
      });
    }

    return next;
  },
};
