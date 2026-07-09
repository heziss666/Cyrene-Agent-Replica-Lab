import { describe, expect, it, vi } from "vitest";
import { runMinimalAgent } from "../../src/main/agent/minimal-agent.js";
import { openAICompatibleAdapter } from "../../src/main/vendors/openai-compatible.js";
import { createUserMessage } from "../../src/shared/chat-types.js";

const config = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  apiKey: "sk-test",
};

describe("chat types", () => {
  it("creates a user message", () => {
    expect(createUserMessage("hello")).toEqual({
      role: "user",
      content: "hello",
    });
  });
});

describe("runMinimalAgent", () => {
  it("calls the model and returns assistant text", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: "assistant",
              content: "你好，我是学习版 Agent。",
            },
            finish_reason: "stop",
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const reply = await runMinimalAgent({
      messages: [createUserMessage("hello")],
      config,
      adapter: openAICompatibleAdapter,
      fetchImpl: fetchMock,
    });

    expect(reply).toBe("你好，我是学习版 Agent。");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws a clear error when the model request fails", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "invalid api key",
    })) as unknown as typeof fetch;

    await expect(
      runMinimalAgent({
        messages: [createUserMessage("hello")],
        config,
        adapter: openAICompatibleAdapter,
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow("Model request failed: HTTP 401");
  });
});
