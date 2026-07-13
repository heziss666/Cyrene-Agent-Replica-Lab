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
}

export async function requestChatCompletion(
  input: RequestChatCompletionInput,
): Promise<ChatCompletionResult> {
  const request = input.adapter.buildRequest(
    { messages: input.messages, tools: input.tools },
    input.config,
  );
  const response = await (input.fetchImpl ?? fetch)(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body ? ` - ${body.slice(0, 200)}` : "";
    throw new Error(`Model request failed: HTTP ${response.status}${detail}`);
  }
  return input.adapter.parseResponse(await response.json());
}
