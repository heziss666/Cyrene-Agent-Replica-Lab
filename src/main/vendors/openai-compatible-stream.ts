import type { ChatMessage } from "../../shared/chat-types.js";
import type { ToolCall } from "../tools/tool-types.js";
import { parseSseData, readableStreamChunks } from "./sse-parser.js";
import type { RequestChatCompletionInput } from "./chat-completion-client.js";
import type { ChatCompletionResult } from "./types.js";

interface ToolParts { id: string; name: string; arguments: string }
export async function requestChatCompletionStream(input: RequestChatCompletionInput & {
  onTextDelta?: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<ChatCompletionResult> {
  const request = input.adapter.buildRequest({ messages: input.messages, tools: input.tools, toolChoice: input.toolChoice, stream: true }, input.config);
  const attempts = Math.min(5, Math.max(1, input.maxAttempts ?? 1)); let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let emitted = false;
    try {
      const response = await (input.fetchImpl ?? fetch)(request.url, { method: request.method, headers: request.headers, body: request.body, signal: input.signal });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Model request failed: HTTP ${response.status}${detail ? ` - ${detail.slice(0, 200)}` : ""}`);
      }
      if (!response.body) throw new Error("MODEL_STREAM_BODY_MISSING");
      let text = ""; let finishReason = "unknown"; let usage: ChatCompletionResult["usage"]; const parts = new Map<number, ToolParts>();
      for await (const data of parseSseData(readableStreamChunks(response.body))) {
        if (data === "[DONE]") break;
        const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        const choice = payload.choices?.[0]; const delta = choice?.delta?.content;
        if (delta) { emitted = true; text += delta; input.onTextDelta?.(delta); }
        for (const tool of choice?.delta?.tool_calls ?? []) {
          emitted = true; const index = tool.index ?? 0; const current = parts.get(index) ?? { id: "", name: "", arguments: "" };
          current.id += tool.id ?? ""; current.name += tool.function?.name ?? ""; current.arguments += tool.function?.arguments ?? ""; parts.set(index, current);
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (payload.usage) usage = { input: payload.usage.prompt_tokens ?? 0, output: payload.usage.completion_tokens ?? 0 };
      }
      const toolCalls: ToolCall[] = [...parts.values()].map((part, index) => ({ id: part.id || `call_${index}`, name: part.name || "unknown_tool", arguments: part.arguments || "{}" }));
      const assistantMessage: ChatMessage = { role: "assistant", content: text, ...(toolCalls.length ? { toolCalls } : {}) };
      return { assistantMessage, text, finishReason, toolCalls, ...(usage ? { usage } : {}) };
    } catch (error) {
      lastError = error; if (emitted || attempt >= attempts || input.signal?.aborted) throw error;
      await (input.retryDelay ?? ((n) => new Promise((resolve) => setTimeout(resolve, 500 * n))))(attempt);
    }
  }
  throw lastError;
}
