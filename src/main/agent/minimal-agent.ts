import type { ChatMessage } from "../../shared/chat-types.js";
import type { ModelConfig } from "../config/model-config.js";
import type { VendorAdapter } from "../vendors/types.js";

export interface RunMinimalAgentInput {
  messages: ChatMessage[];
  config: ModelConfig;
  adapter: VendorAdapter;
  fetchImpl?: typeof fetch;
}

export async function runMinimalAgent(input: RunMinimalAgentInput): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const request = input.adapter.buildRequest({ messages: input.messages }, input.config);

  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body ? ` - ${body.slice(0, 200)}` : "";
    throw new Error(`Model request failed: HTTP ${response.status}${detail}`);
  }

  const data = await response.json();
  return input.adapter.parseResponse(data).text;
}
