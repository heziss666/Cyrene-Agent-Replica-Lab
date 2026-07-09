export type AgentEvent =
  | {
      type: "run_started";
      inputMessageCount: number;
      maxRounds: number;
    }
  | {
      type: "model_call_started";
      round: number;
      messageCount: number;
      toolCount: number;
    }
  | {
      type: "model_call_finished";
      round: number;
      text: string;
      toolCallCount: number;
    }
  | {
      type: "tool_call_started";
      round: number;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_call_finished";
      round: number;
      toolCallId: string;
      toolName: string;
      output: string;
    }
  | {
      type: "final_reply";
      round: number;
      text: string;
    }
  | {
      type: "run_finished";
      roundsUsed: number;
      toolResultCount: number;
    }
  | {
      type: "run_error";
      message: string;
    };

export interface AgentTraceCollector {
  events: AgentEvent[];
  onEvent: (event: AgentEvent) => void;
}

function preview(value: string, maxLength = 155): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength)}...` : singleLine;
}

export function formatAgentEventForTerminal(event: AgentEvent): string {
  switch (event.type) {
    case "run_started":
      return `[run] started messages=${event.inputMessageCount} maxRounds=${event.maxRounds}`;
    case "model_call_started":
      return `[model] round ${event.round} -> messages=${event.messageCount} tools=${event.toolCount}`;
    case "model_call_finished":
      return `[model] round ${event.round} <- toolCalls=${event.toolCallCount}`;
    case "tool_call_started":
      return `[tool] round ${event.round} -> ${event.toolName} args=${JSON.stringify(event.args)}`;
    case "tool_call_finished":
      return `[tool] round ${event.round} <- ${event.toolName} result=${preview(event.output)}`;
    case "final_reply":
      return `[agent] round ${event.round} final=${preview(event.text)}`;
    case "run_finished":
      return `[run] finished rounds=${event.roundsUsed} toolResults=${event.toolResultCount}`;
    case "run_error":
      return `[run] error ${preview(event.message)}`;
  }
}

export function createAgentTraceCollector(): AgentTraceCollector {
  const events: AgentEvent[] = [];
  return {
    events,
    onEvent: (event) => {
      events.push(event);
    },
  };
}
