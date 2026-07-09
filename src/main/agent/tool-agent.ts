import type { ChatMessage } from "../../shared/chat-types.js";
import type { ModelConfig } from "../config/model-config.js";
import type { ToolCall, ToolExecutionResult } from "../tools/tool-types.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import type { VendorAdapter } from "../vendors/types.js";

const DEFAULT_MAX_ROUNDS = 5;

export interface RunToolAgentInput {
  messages: ChatMessage[];
  config: ModelConfig;
  adapter: VendorAdapter;
  toolRegistry: ToolRegistry;
  fetchImpl?: typeof fetch;
  maxRounds?: number;
}

export interface ToolAgentResult {
  reply: string;
  messages: ChatMessage[];
  toolResults: ToolExecutionResult[];
}

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
): Promise<ToolExecutionResult> {
  const args = parseToolArguments(toolCall);
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
  const fetchImpl = input.fetchImpl ?? fetch;
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;
  let conversation = input.messages.map((message) => ({ ...message }));
  const allToolResults: ToolExecutionResult[] = [];

  for (let round = 0; round < maxRounds; round += 1) {
    const request = input.adapter.buildRequest(
      {
        messages: conversation,
        tools: input.toolRegistry.getEnabledToolSpecs(),
      },
      input.config,
    );

    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const detail = body ? ` - ${body.slice(0, 200)}` : "";
      throw new Error(`Model request failed: HTTP ${response.status}${detail}`);
    }

    const data = await response.json();
    const completion = input.adapter.parseResponse(data);
    conversation.push(completion.assistantMessage);

    if (completion.toolCalls.length === 0) {
      return {
        reply: completion.text,
        messages: conversation,
        toolResults: allToolResults,
      };
    }

    const roundToolResults: ToolExecutionResult[] = [];
    for (const toolCall of completion.toolCalls) {
      const result = await executeToolCall(toolCall, input.toolRegistry);
      roundToolResults.push(result);
      allToolResults.push(result);
    }

    conversation = input.adapter.appendToolResults(conversation, roundToolResults);
  }

  throw new Error(`Tool agent exceeded max rounds: ${maxRounds}`);
}
