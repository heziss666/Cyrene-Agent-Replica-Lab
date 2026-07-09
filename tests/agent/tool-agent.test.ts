import { describe, expect, it, vi } from "vitest";
import { runToolAgent } from "../../src/main/agent/tool-agent.js";
import { createDefaultToolRegistry } from "../../src/main/tools/built-in-tools.js";
import { ToolRegistry } from "../../src/main/tools/tool-registry.js";
import { openAICompatibleAdapter } from "../../src/main/vendors/openai-compatible.js";
import { createUserMessage } from "../../src/shared/chat-types.js";

const config = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  apiKey: "sk-test",
};

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}

describe("runToolAgent", () => {
  it("returns assistant text when the model does not request tools", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: { role: "assistant", content: "No tool needed." },
            finish_reason: "stop",
          },
        ],
      }),
    );

    const result = await runToolAgent({
      messages: [createUserMessage("hello")],
      config,
      adapter: openAICompatibleAdapter,
      toolRegistry: createDefaultToolRegistry(),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.reply).toBe("No tool needed.");
    expect(result.toolResults).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("executes a requested tool and asks the model for a final reply", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_echo",
                    type: "function",
                    function: {
                      name: "echo",
                      arguments: "{\"text\":\"hello from tool\"}",
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                role: "assistant",
                content: "The tool returned: hello from tool",
              },
              finish_reason: "stop",
            },
          ],
        }),
      );

    const result = await runToolAgent({
      messages: [createUserMessage("echo something")],
      config,
      adapter: openAICompatibleAdapter,
      toolRegistry: createDefaultToolRegistry(),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.reply).toBe("The tool returned: hello from tool");
    expect(result.toolResults).toEqual([
      {
        toolCall: {
          id: "call_echo",
          name: "echo",
          arguments: "{\"text\":\"hello from tool\"}",
        },
        output: "hello from tool",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondBody.messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_echo",
      name: "echo",
      content: "hello from tool",
    });
  });

  it("returns unknown tool errors as tool results", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_missing",
                    type: "function",
                    function: {
                      name: "missing_tool",
                      arguments: "{}",
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                role: "assistant",
                content: "I could not use that tool.",
              },
              finish_reason: "stop",
            },
          ],
        }),
      );

    const result = await runToolAgent({
      messages: [createUserMessage("use a missing tool")],
      config,
      adapter: openAICompatibleAdapter,
      toolRegistry: new ToolRegistry(),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.toolResults[0]?.output).toContain("[error] tool is not available");
    expect(result.reply).toBe("I could not use that tool.");
  });
});
