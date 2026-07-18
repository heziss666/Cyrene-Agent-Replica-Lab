import type { ChatMessage } from "../../shared/chat-types.js";
import type { AgentEvent } from "../agent/agent-events.js";
import { runToolAgent, type ToolAgentResult } from "../agent/tool-agent.js";
import type { ModelConfig } from "../config/model-config.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import type { VendorAdapter } from "../vendors/types.js";
import type { ScheduledTask, ScheduledToolCallRecord } from "./scheduled-task-types.js";
import type { AgentRunExecutionContext, AgentRunManager } from "../runs/agent-run-manager.js";

export interface ScheduledAgentRunResult {
  status: "succeeded" | "failed" | "needs_attention";
  reply?: string;
  toolCalls: ScheduledToolCallRecord[];
  errorCode?: string;
  agentRunId?: string;
}

export interface ScheduledAgentRunner {
  run(input: {
    runId: string;
    task: ScheduledTask;
    executionMode?: "interactive" | "scheduled";
  }): Promise<ScheduledAgentRunResult>;
}

export interface ScheduledAgentRunnerOptions {
  composeSystemPrompt(taskPrompt: string): Promise<string>;
  createToolRegistry(): ToolRegistry;
  getModelConfig(): ModelConfig;
  adapter: VendorAdapter;
  runAgent?: typeof runToolAgent;
  timeoutMs?: number;
  now?: () => Date;
  onEvent?: (runId: string, event: AgentEvent) => void;
  agentRunManager?: AgentRunManager;
}

export function createScheduledAgentRunner(
  options: ScheduledAgentRunnerOptions,
): ScheduledAgentRunner {
  const executeAgent = options.runAgent ?? runToolAgent;
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const now = options.now ?? (() => new Date());

  async function runDirect(
    input: Parameters<ScheduledAgentRunner["run"]>[0],
    managed?: AgentRunExecutionContext,
  ): Promise<ScheduledAgentRunResult> {
      const { runId, task, executionMode = "scheduled" } = input;

      const toolCalls: ScheduledToolCallRecord[] = [];
      const byCallId = new Map<string, ScheduledToolCallRecord>();
      let needsAttention = false;
      const onEvent = (event: AgentEvent): void => {
        options.onEvent?.(runId, event);
        managed?.emit("agent_event", { agentEvent: event });
        if (event.type === "tool_call_started") {
          const record: ScheduledToolCallRecord = {
            toolId: event.toolName,
            args: sanitizeRecord(event.args),
            status: "failed",
            startedAt: validNow(now()).toISOString(),
          };
          toolCalls.push(record);
          byCallId.set(event.toolCallId, record);
        }
        if (event.type === "tool_call_finished") {
          const record = byCallId.get(event.toolCallId);
          if (!record) return;
          record.finishedAt = validNow(now()).toISOString();
          record.outputSummary = preview(event.output, 2_000);
          if (isApprovalFailure(event.output)) {
            record.status = "blocked";
            record.approvalRequired = true;
            record.errorCode = "SCHEDULE_APPROVAL_REQUIRED";
            needsAttention = true;
          } else if (/^\[error\]/.test(event.output) || /^\[MCP_TOOL_ERROR\]/.test(event.output)) {
            record.status = "failed";
          } else {
            record.status = "succeeded";
          }
        }
      };

      try {
        const systemPrompt = await options.composeSystemPrompt(task.prompt);
        const messages: ChatMessage[] = [
          { role: "system", content: systemPrompt },
          { role: "user", content: task.prompt },
        ];
        const result = await withTimeout<ToolAgentResult>(executeAgent({
          messages,
          config: options.getModelConfig(),
          adapter: options.adapter,
          toolRegistry: options.createToolRegistry(),
          executionMode,
          timezone: task.timezone,
          initialToolChoice: taskRequiresTool(task.prompt) ? "required" : "auto",
          modelRequestMaxAttempts: 3,
          signal: managed?.signal,
          onEvent,
        }), timeoutMs);
        return {
          status: needsAttention ? "needs_attention" : "succeeded",
          reply: result.reply.slice(0, 40_000),
          toolCalls,
          ...(needsAttention ? { errorCode: "SCHEDULE_APPROVAL_REQUIRED" } : {}),
        };
      } catch (error) {
        const code = scheduledErrorCode(error);
        return { status: "failed", toolCalls, errorCode: code };
      }
  }

  return {
    async run(input) {
      if (!options.agentRunManager) return runDirect(input);
      let result: ScheduledAgentRunResult | undefined;
      const accepted = await options.agentRunManager.submit({
        source: "scheduler",
        taskId: input.task.id,
        execute: async (context) => {
          result = await runDirect(input, context);
          if (result.status === "failed") throw new Error(result.errorCode ?? "SCHEDULE_AGENT_FAILED");
        },
      });
      const terminal = await options.agentRunManager.wait(accepted.runId);
      return result
        ? { ...result, agentRunId: accepted.runId }
        : {
          status: "failed",
          toolCalls: [],
          errorCode: terminal?.error?.code ?? "SCHEDULE_AGENT_FAILED",
          agentRunId: accepted.runId,
        };
    },
  };
}

function taskRequiresTool(prompt: string): boolean {
  return /\b(?:use|call|invoke)(?:\s+\w+){0,6}\s+tools?\b|\bwhat\s+tools?.{0,24}\b(?:called|used)\b|\bcurrent\s+time\b|\bwhat\s+time\b/i.test(prompt)
    || /\u8c03\u7528(?:\u4e86)?.{0,24}\u5de5\u5177|\u4f7f\u7528.{0,24}\u5de5\u5177|\u73b0\u5728\u7684\u65f6\u95f4|\u5f53\u524d\u65f6\u95f4|\u51e0\u70b9/u.test(prompt);
}

function scheduledErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "SCHEDULE_AGENT_FAILED";
  if (error.message === "SCHEDULE_AGENT_TIMEOUT") return "SCHEDULE_AGENT_TIMEOUT";
  const httpStatus = /^Model request failed: HTTP (\d{3})\b/.exec(error.message)?.[1];
  if (httpStatus) return `SCHEDULE_MODEL_HTTP_${httpStatus}`;
  if (/Tool agent exceeded max rounds/.test(error.message)) return "SCHEDULE_AGENT_MAX_ROUNDS";
  if (/\bfetch failed\b|\bnetwork\b/i.test(error.message)) return "SCHEDULE_MODEL_NETWORK_FAILED";
  return "SCHEDULE_AGENT_FAILED";
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("SCHEDULE_AGENT_TIMEOUT")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sanitizeRecord(input: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(input, 0) as Record<string, unknown>;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 5) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value !== "object" || value === null) return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).slice(0, 100)) {
    output[key] = /token|secret|password|authorization|api.?key/i.test(key)
      ? "[REDACTED]"
      : sanitizeValue(child, depth + 1);
  }
  return output;
}

function isApprovalFailure(output: string): boolean {
  return output.includes("MCP_PERMISSION_DENIED")
    || output.includes("APPROVAL_TIMEOUT")
    || output.includes("NO_APPROVAL_WINDOW")
    || output.includes("USER_DENIED");
}

function preview(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
}

function validNow(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("SCHEDULE_TIME_INVALID");
  return value;
}
