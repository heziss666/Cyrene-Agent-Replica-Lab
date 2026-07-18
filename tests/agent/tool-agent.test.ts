import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../src/main/agent/agent-events.js";
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
  it("streams text deltas through the agent", async () => {
    const body = "data: {\"choices\":[{\"delta\":{\"content\":\"hello \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"world\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
    const deltas: string[] = [];
    const result = await runToolAgent({ messages: [createUserMessage("hi")], config, adapter: openAICompatibleAdapter,
      toolRegistry: createDefaultToolRegistry(), fetchImpl: (async () => new Response(body)) as typeof fetch,
      stream: true, onTextDelta: (delta) => deltas.push(delta) });
    expect(deltas).toEqual(["hello ", "world"]); expect(result.reply).toBe("hello world");
  });

  it("does not start a tool after cancellation", async () => {
    const controller = new AbortController(); let executed = false; const registry = new ToolRegistry();
    registry.register({ id: "danger", description: "danger", enabled: true, parameters: { type: "object", properties: {} }, execute: async () => { executed = true; return "done"; } });
    const fetchMock = vi.fn(async () => { controller.abort(); return jsonResponse({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c", type: "function", function: { name: "danger", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }); });
    await expect(runToolAgent({ messages: [createUserMessage("go")], config, adapter: openAICompatibleAdapter, toolRegistry: registry, fetchImpl: fetchMock as typeof fetch, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(executed).toBe(false);
  });

  it("requires a tool only on the first round when requested", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call", type: "function", function: { name: "get_current_time", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }] }));

    await runToolAgent({
      messages: [createUserMessage("Use the time tool")],
      config,
      adapter: openAICompatibleAdapter,
      toolRegistry: createDefaultToolRegistry(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      initialToolChoice: "required",
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).tool_choice).toBe("required");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).tool_choice).toBe("auto");
  });

  it("passes the scheduled execution mode to tools", async () => {
    const registry = new ToolRegistry();
    let seenMode: string | undefined;
    registry.register({
      id: "inspect_mode", description: "inspect", enabled: true,
      parameters: { type: "object", properties: {} },
      execute: async (_args, context) => { seenMode = context?.executionMode; return "ok"; },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call", type: "function", function: { name: "inspect_mode", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }] }));
    await runToolAgent({ messages: [createUserMessage("run")], config, adapter: openAICompatibleAdapter,
      toolRegistry: registry, fetchImpl: fetchMock as unknown as typeof fetch, executionMode: "scheduled" });
    expect(seenMode).toBe("scheduled");
  });

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

    const events: AgentEvent[] = [];

    const result = await runToolAgent({
      messages: [createUserMessage("echo something")],
      config,
      adapter: openAICompatibleAdapter,
      toolRegistry: createDefaultToolRegistry(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      onEvent: (event) => events.push(event),
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
    expect(events).toEqual([
      {
        type: "run_started",
        inputMessageCount: 1,
        maxRounds: 5,
      },
      {
        type: "model_call_started",
        round: 1,
        messageCount: 1,
        toolCount: 4,
      },
      {
        type: "model_call_finished",
        round: 1,
        text: "",
        toolCallCount: 1,
      },
      {
        type: "tool_call_started",
        round: 1,
        toolCallId: "call_echo",
        toolName: "echo",
        args: { text: "hello from tool" },
      },
      {
        type: "tool_call_finished",
        round: 1,
        toolCallId: "call_echo",
        toolName: "echo",
        output: "hello from tool",
      },
      {
        type: "model_call_started",
        round: 2,
        messageCount: 3,
        toolCount: 4,
      },
      {
        type: "model_call_finished",
        round: 2,
        text: "The tool returned: hello from tool",
        toolCallCount: 0,
      },
      {
        type: "final_reply",
        round: 2,
        text: "The tool returned: hello from tool",
      },
      {
        type: "run_finished",
        roundsUsed: 2,
        toolResultCount: 1,
      },
    ]);
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

  it("emits a run error event when the model request fails", async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => "upstream failed",
      }) as Response,
    );
    const events: AgentEvent[] = [];

    await expect(
      runToolAgent({
        messages: [createUserMessage("hello")],
        config,
        adapter: openAICompatibleAdapter,
        toolRegistry: createDefaultToolRegistry(),
        fetchImpl: fetchMock as unknown as typeof fetch,
        onEvent: (event) => events.push(event),
      }),
    ).rejects.toThrow("Model request failed: HTTP 500 - upstream failed");

    expect(events).toEqual([
      {
        type: "run_started",
        inputMessageCount: 1,
        maxRounds: 5,
      },
      {
        type: "model_call_started",
        round: 1,
        messageCount: 1,
        toolCount: 4,
      },
      {
        type: "run_error",
        message: "Model request failed: HTTP 500 - upstream failed",
      },
    ]);
  });
});
