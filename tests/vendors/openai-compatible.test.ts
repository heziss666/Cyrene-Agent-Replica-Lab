import { describe, expect, it } from "vitest";
import { openAICompatibleAdapter } from "../../src/main/vendors/openai-compatible.js";

const config = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  apiKey: "sk-test",
};

describe("openAICompatibleAdapter", () => {
  it("builds a chat completions request", () => {
    const request = openAICompatibleAdapter.buildRequest(
      {
        messages: [{ role: "user", content: "hello" }],
      },
      config,
    );

    expect(request.url).toBe("https://api.deepseek.com/chat/completions");
    expect(request.method).toBe("POST");
    expect(request.headers.Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(request.body)).toEqual({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    });
  });

  it("builds a chat completions request with tools", () => {
    const request = openAICompatibleAdapter.buildRequest(
      {
        messages: [{ role: "user", content: "What time is it?" }],
        tools: [
          {
            name: "get_current_time",
            description: "Return the current time.",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        ],
      },
      config,
    );

    expect(JSON.parse(request.body)).toEqual({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "What time is it?" }],
      stream: false,
      tools: [
        {
          type: "function",
          function: {
            name: "get_current_time",
            description: "Return the current time.",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
      ],
      tool_choice: "auto",
    });
  });

  it("can require a tool call for a guarded model round", () => {
    const request = openAICompatibleAdapter.buildRequest(
      {
        messages: [{ role: "user", content: "Use a tool." }],
        tools: [{
          name: "get_current_time",
          description: "Return the current time.",
          parameters: { type: "object", properties: {} },
        }],
        toolChoice: "required",
      },
      config,
    );

    expect(JSON.parse(request.body).tool_choice).toBe("required");
  });

  it("parses assistant text from an OpenAI-compatible response", () => {
    const result = openAICompatibleAdapter.parseResponse({
      choices: [
        {
          message: {
            role: "assistant",
            content: "你好",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
      },
    });

    expect(result).toEqual({
      assistantMessage: {
        role: "assistant",
        content: "你好",
      },
      text: "你好",
      finishReason: "stop",
      toolCalls: [],
      usage: {
        input: 10,
        output: 5,
      },
    });
  });

  it("returns empty text when the response has no assistant content", () => {
    const result = openAICompatibleAdapter.parseResponse({ choices: [] });

    expect(result.text).toBe("");
    expect(result.finishReason).toBe("unknown");
  });

  it("parses tool calls from an OpenAI-compatible response", () => {
    const result = openAICompatibleAdapter.parseResponse({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: {
                  name: "calculator",
                  arguments: "{\"expression\":\"2+2\"}",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });

    expect(result.assistantMessage).toEqual({
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call_123",
          name: "calculator",
          arguments: "{\"expression\":\"2+2\"}",
        },
      ],
    });
    expect(result.toolCalls).toEqual([
      {
        id: "call_123",
        name: "calculator",
        arguments: "{\"expression\":\"2+2\"}",
      },
    ]);
    expect(result.finishReason).toBe("tool_calls");
  });

  it("appends tool result messages", () => {
    const messages = openAICompatibleAdapter.appendToolResults(
      [
        { role: "user", content: "calculate 2+2" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_123", name: "calculator", arguments: "{}" }],
        },
      ],
      [
        {
          toolCall: { id: "call_123", name: "calculator", arguments: "{}" },
          output: "4",
        },
      ],
    );

    expect(messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "call_123",
      name: "calculator",
      content: "4",
    });
  });
});
