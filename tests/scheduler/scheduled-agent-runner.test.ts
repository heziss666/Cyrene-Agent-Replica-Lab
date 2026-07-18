import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../src/main/agent/agent-events.js";
import { createScheduledAgentRunner } from "../../src/main/scheduler/scheduled-agent-runner.js";
import type { ScheduledTask } from "../../src/main/scheduler/scheduled-task-types.js";
import { ToolRegistry } from "../../src/main/tools/tool-registry.js";

const task: ScheduledTask = {
  id: "daily", name: "Daily", prompt: "Summarize GitHub",
  schedule: { kind: "cron", expression: "0 9 * * *" }, timezone: "Asia/Shanghai",
  missedRunPolicy: "run-once", enabled: true,
  nextRunAt: "2026-07-19T01:00:00.000Z",
  createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z",
};

describe("scheduled agent runner", () => {
  it("requires an initial tool call when the task explicitly asks to use a tool", async () => {
    const runAgent = vi.fn(async (_input: Record<string, unknown>) => ({ reply: "ok", messages: [], toolResults: [] }));
    const runner = createScheduledAgentRunner({
      composeSystemPrompt: async () => "SYSTEM",
      createToolRegistry: () => new ToolRegistry(),
      getModelConfig: () => ({ provider: "deepseek", baseUrl: "https://example.com", model: "x", apiKey: "secret" }),
      adapter: {} as never,
      runAgent: runAgent as never,
    });
    const toolTask = { ...task, prompt: "请告诉我现在的时间，并简要说明你调用了什么工具" };

    await runner.run({ runId: "run-tool-required", task: toolTask });

    expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
      initialToolChoice: "required",
      timezone: "Asia/Shanghai",
      modelRequestMaxAttempts: 3,
    });
  });

  it("runs isolated system/user messages with a fresh registry and captures safe tool traces", async () => {
    const registryFactory = vi.fn(() => new ToolRegistry());
    const runAgent = vi.fn(async (input: { messages: Array<{ role: string; content: string }>; executionMode?: string; onEvent?: (event: AgentEvent) => void }) => {
      input.onEvent?.({ type: "tool_call_started", round: 1, toolCallId: "c1", toolName: "github__list_issues", args: { owner: "me", token: "secret" } });
      input.onEvent?.({ type: "tool_call_finished", round: 1, toolCallId: "c1", toolName: "github__list_issues", output: "three issues" });
      return { reply: "Summary", messages: input.messages, toolResults: [] };
    });
    const runner = createScheduledAgentRunner({
      composeSystemPrompt: async () => "SYSTEM MEMORY",
      createToolRegistry: registryFactory,
      getModelConfig: () => ({ provider: "deepseek", baseUrl: "https://example.com", model: "x", apiKey: "secret" }),
      adapter: {} as never,
      runAgent: runAgent as never,
      now: () => new Date("2026-07-19T01:00:00.000Z"),
    });
    const result = await runner.run({ runId: "run-1", task });
    expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
      messages: [{ role: "system", content: "SYSTEM MEMORY" }, { role: "user", content: "Summarize GitHub" }],
      executionMode: "scheduled",
    });
    expect(registryFactory).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: "succeeded", reply: "Summary" });
    expect(result.toolCalls[0]?.args).toEqual({ owner: "me", token: "[REDACTED]" });
  });

  it("marks permission denials as needs_attention", async () => {
    const runner = createScheduledAgentRunner({
      composeSystemPrompt: async () => "SYSTEM",
      createToolRegistry: () => new ToolRegistry(),
      getModelConfig: () => ({ provider: "deepseek", baseUrl: "https://example.com", model: "x", apiKey: "secret" }),
      adapter: {} as never,
      runAgent: (async (input: { onEvent?: (event: AgentEvent) => void }) => {
        input.onEvent?.({ type: "tool_call_started", round: 1, toolCallId: "c1", toolName: "github__delete_file", args: { path: "a" } });
        input.onEvent?.({ type: "tool_call_finished", round: 1, toolCallId: "c1", toolName: "github__delete_file", output: "[MCP_PERMISSION_DENIED] USER_DENIED" });
        return { reply: "Approval required", messages: [], toolResults: [] };
      }) as never,
    });
    await expect(runner.run({ runId: "run-2", task })).resolves.toMatchObject({
      status: "needs_attention", errorCode: "SCHEDULE_APPROVAL_REQUIRED",
    });
  });

  it("preserves the model HTTP status in a failed scheduled run", async () => {
    const runner = createScheduledAgentRunner({
      composeSystemPrompt: async () => "SYSTEM",
      createToolRegistry: () => new ToolRegistry(),
      getModelConfig: () => ({ provider: "deepseek", baseUrl: "https://example.com", model: "x", apiKey: "secret" }),
      adapter: {} as never,
      runAgent: (async () => { throw new Error("Model request failed: HTTP 503 - busy"); }) as never,
    });

    await expect(runner.run({ runId: "run-http-error", task })).resolves.toMatchObject({
      status: "failed",
      errorCode: "SCHEDULE_MODEL_HTTP_503",
    });
  });
});
