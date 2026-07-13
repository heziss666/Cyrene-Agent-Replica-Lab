import { describe, expect, it, vi } from "vitest";
import { requestChatCompletion } from "../../src/main/vendors/chat-completion-client.js";

const config = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  apiKey: "sk-test",
};

describe("requestChatCompletion", () => {
  it("builds, sends, and parses exactly one request", async () => {
    const completion = {
      assistantMessage: { role: "assistant" as const, content: "hello" },
      text: "hello",
      finishReason: "stop",
      toolCalls: [],
    };
    const adapter = {
      id: "fake",
      buildRequest: vi.fn(() => ({
        url: "https://example.test/chat",
        method: "POST" as const,
        headers: { Authorization: "Bearer test" },
        body: "{}",
      })),
      parseResponse: vi.fn(() => completion),
      appendToolResults: vi.fn(),
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(requestChatCompletion({
      messages: [{ role: "user", content: "hi" }],
      config,
      adapter,
      fetchImpl: fetchImpl as typeof fetch,
    })).resolves.toBe(completion);
    expect(adapter.buildRequest).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(adapter.parseResponse).toHaveBeenCalledWith({ ok: true });
  });

  it("includes a bounded response body in HTTP errors", async () => {
    const adapter = {
      id: "fake",
      buildRequest: vi.fn(() => ({
        url: "https://example.test/chat",
        method: "POST" as const,
        headers: {},
        body: "{}",
      })),
      parseResponse: vi.fn(),
      appendToolResults: vi.fn(),
    };
    const fetchImpl = vi.fn(async () => new Response("upstream failed", { status: 503 }));

    await expect(requestChatCompletion({
      messages: [], config, adapter, fetchImpl: fetchImpl as typeof fetch,
    })).rejects.toThrow("Model request failed: HTTP 503 - upstream failed");
  });
});
