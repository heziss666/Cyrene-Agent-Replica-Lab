import type { ChatMessage } from "../../shared/chat-types.js";
import type { ModelConfig } from "../config/model-config.js";
import type { ToolSpec } from "../tools/tool-types.js";
import type { ChatCompletionResult, VendorAdapter } from "./types.js";

export interface RequestChatCompletionInput {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  config: ModelConfig;
  adapter: VendorAdapter;
  fetchImpl?: typeof fetch;
  toolChoice?: "auto" | "required";
  maxAttempts?: number;
  retryDelay?: (attempt: number) => Promise<void>;
}

export async function requestChatCompletion(
  input: RequestChatCompletionInput,
): Promise<ChatCompletionResult> {
  const request = input.adapter.buildRequest(
    { messages: input.messages, tools: input.tools, toolChoice: input.toolChoice },
    input.config,
  );
  const attempts = Math.min(5, Math.max(1, input.maxAttempts ?? 1));
  const delay = input.retryDelay ?? defaultRetryDelay;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await (input.fetchImpl ?? fetch)(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
      if (response.ok) return input.adapter.parseResponse(await response.json());
      const body = await response.text().catch(() => "");
      const detail = body ? ` - ${body.slice(0, 200)}` : "";
      if (attempt < attempts && isTransientStatus(response.status)) {
        await delay(attempt);
        continue;
      }
      throw new Error(`Model request failed: HTTP ${response.status}${detail}`);
    } catch (error) {
      if (attempt >= attempts || isModelHttpError(error)) throw error;
      await delay(attempt);
    }
  }
  throw new Error("Model request failed");
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isModelHttpError(error: unknown): boolean {
  return error instanceof Error && /^Model request failed: HTTP /.test(error.message);
}

function defaultRetryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.min(2_000, 500 * (2 ** (attempt - 1)))));
}
