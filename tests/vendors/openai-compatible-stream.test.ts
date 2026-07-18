import { describe, expect, it, vi } from "vitest";
import { requestChatCompletionStream } from "../../src/main/vendors/openai-compatible-stream.js";
import { openAICompatibleAdapter } from "../../src/main/vendors/openai-compatible.js";
const config = { provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "x", apiKey: "fake" };
function response(events: unknown[]): Response { const text = events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join(""); return new Response(text, { status: 200 }); }

describe("requestChatCompletionStream", () => {
  it("streams text and assembles split tool calls", async () => {
    const deltas: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response([
      { choices: [{ delta: { content: "Hi " } }] }, { choices: [{ delta: { content: "there" } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "calcu", arguments: "{\"expression\":" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "lator", arguments: "\"2+2\"}" } }] }, finish_reason: "tool_calls" }] }, "[DONE]",
    ]));
    const result = await requestChatCompletionStream({ messages: [{ role: "user", content: "go" }], tools: [{ name: "calculator", description: "calc", parameters: { type: "object", properties: {} } }], config, adapter: openAICompatibleAdapter, fetchImpl: fetchImpl as typeof fetch, onTextDelta: (d) => deltas.push(d) });
    expect(deltas).toEqual(["Hi ", "there"]); expect(result.text).toBe("Hi there");
    expect(result.toolCalls).toEqual([{ id: "call_1", name: "calculator", arguments: "{\"expression\":\"2+2\"}" }]);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).stream).toBe(true);
  });
});
