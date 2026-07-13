import type { ChatMessage } from "../../shared/chat-types.js";
import type { AgentEvent } from "./agent-events.js";
import type { ModelConfig } from "../config/model-config.js";
import type { ToolCall, ToolExecutionResult } from "../tools/tool-types.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import { requestChatCompletion } from "../vendors/chat-completion-client.js";
import type { VendorAdapter } from "../vendors/types.js";

const DEFAULT_MAX_ROUNDS = 5;

export interface RunToolAgentInput {
  messages: ChatMessage[];
  config: ModelConfig;
  adapter: VendorAdapter;
  toolRegistry: ToolRegistry;
  fetchImpl?: typeof fetch;
  maxRounds?: number;
  onEvent?: (event: ToolAgentEvent) => void;
}

export interface ToolAgentResult {
  reply: string;
  messages: ChatMessage[];
  toolResults: ToolExecutionResult[];
}

export type ToolAgentEvent = AgentEvent;

function parseToolArguments(toolCall: ToolCall): Record<string, unknown> {
  try {
    const parsed = JSON.parse(toolCall.arguments || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {
      __toolArgumentError: `Invalid JSON arguments: ${toolCall.arguments}`,
    };
  }
}

async function executeToolCall(
  toolCall: ToolCall,
  toolRegistry: ToolRegistry,
  parsedArgs?: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const args = parsedArgs ?? parseToolArguments(toolCall);
  if (typeof args.__toolArgumentError === "string") {
    return {
      toolCall,
      output: `[error] ${args.__toolArgumentError}`,
    };
  }

  const tool = toolRegistry.getById(toolCall.name);
  if (!tool || !tool.enabled) {
    return {
      toolCall,
      output: `[error] tool is not available: ${toolCall.name}`,
    };
  }

  try {
    return {
      toolCall,
      output: await tool.execute(args),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      toolCall,
      output: `[error] tool execution failed: ${message}`,
    };
  }
}

export async function runToolAgent(input: RunToolAgentInput): Promise<ToolAgentResult> {
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;
  let conversation = input.messages.map((message) => ({ ...message }));
  const allToolResults: ToolExecutionResult[] = [];
  let runErrorEmitted = false;

  const emit = (event: AgentEvent): void => {
    input.onEvent?.(event);
  };

  const emitRunError = (message: string): void => {
    if (runErrorEmitted) return;
    runErrorEmitted = true;
    emit({ type: "run_error", message });
  };

  try {
    emit({
      type: "run_started",
      inputMessageCount: conversation.length,
      maxRounds,
    });

    for (let round = 0; round < maxRounds; round += 1) {
      const roundNumber = round + 1;
      const tools = input.toolRegistry.getEnabledToolSpecs();

      emit({
        type: "model_call_started",
        round: roundNumber,
        messageCount: conversation.length,
        toolCount: tools.length,
      });

      const completion = await requestChatCompletion({
        messages: conversation,
        tools,
        config: input.config,
        adapter: input.adapter,
        fetchImpl: input.fetchImpl,
      });
      emit({
        type: "model_call_finished",
        round: roundNumber,
        text: completion.text,
        toolCallCount: completion.toolCalls.length,
      });
      conversation.push(completion.assistantMessage);

      if (completion.toolCalls.length === 0) {
        emit({
          type: "final_reply",
          round: roundNumber,
          text: completion.text,
        });
        emit({
          type: "run_finished",
          roundsUsed: roundNumber,
          toolResultCount: allToolResults.length,
        });
        return {
          reply: completion.text,
          messages: conversation,
          toolResults: allToolResults,
        };
      }

      const roundToolResults: ToolExecutionResult[] = [];
      for (const toolCall of completion.toolCalls) {
        const args = parseToolArguments(toolCall);
        emit({
          type: "tool_call_started",
          round: roundNumber,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          args:
            typeof args.__toolArgumentError === "string"
              ? {}
              : args,
        });

        const result = await executeToolCall(toolCall, input.toolRegistry, args);
        emit({
          type: "tool_call_finished",
          round: roundNumber,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          output: result.output,
        });
        roundToolResults.push(result);
        allToolResults.push(result);
      }

      conversation = input.adapter.appendToolResults(conversation, roundToolResults);
    }

    throw new Error(`Tool agent exceeded max rounds: ${maxRounds}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitRunError(message);
    throw error;
  }
}
