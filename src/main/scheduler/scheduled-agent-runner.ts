import type { ChatMessage } from "../../shared/chat-types.js";
import type { AgentEvent } from "../agent/agent-events.js";
import { runToolAgent, type ToolAgentResult } from "../agent/tool-agent.js";
import type { ModelConfig } from "../config/model-config.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import type { VendorAdapter } from "../vendors/types.js";
import type { ScheduledTask, ScheduledToolCallRecord } from "./scheduled-task-types.js";

export interface ScheduledAgentRunResult {
  status: "succeeded" | "failed" | "needs_attention";
  reply?: string;
  toolCalls: ScheduledToolCallRecord[];
  errorCode?: string;
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
}

export function createScheduledAgentRunner(
  options: ScheduledAgentRunnerOptions,
): ScheduledAgentRunner {
  const executeAgent = options.runAgent ?? runToolAgent;
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const now = options.now ?? (() => new Date());

  return {
    async run({ runId, task, executionMode = "scheduled" }) {
      const toolCalls: ScheduledToolCallRecord[] = [];
      const byCallId = new Map<string, ScheduledToolCallRecord>();
      let needsAttention = false;
      const onEvent = (event: AgentEvent): void => {
        options.onEvent?.(runId, event);
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
          onEvent,
        }), timeoutMs);
        return {
          status: needsAttention ? "needs_attention" : "succeeded",
          reply: result.reply.slice(0, 40_000),
          toolCalls,
          ...(needsAttention ? { errorCode: "SCHEDULE_APPROVAL_REQUIRED" } : {}),
        };
      } catch (error) {
        const code = error instanceof Error && error.message === "SCHEDULE_AGENT_TIMEOUT"
          ? "SCHEDULE_AGENT_TIMEOUT"
          : "SCHEDULE_AGENT_FAILED";
        return { status: "failed", toolCalls, errorCode: code };
      }
    },
  };
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
