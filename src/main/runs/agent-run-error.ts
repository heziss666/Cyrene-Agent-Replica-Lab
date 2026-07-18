import type { AgentRunError } from "./agent-run-types.js";

export function normalizeAgentRunError(error: unknown): AgentRunError {
  const value = error instanceof Error ? error : new Error(String(error));
  if (value.name === "AbortError" || value.message === "RUN_CANCELLED") {
    return { code: "RUN_CANCELLED", category: "cancelled", retryable: false, safeMessage: "Run cancelled" };
  }
  const http = /^Model request failed: HTTP (\d{3})\b/.exec(value.message);
  if (http) {
    const status = Number(http[1]);
    return {
      code: status >= 500 ? "MODEL_HTTP_5XX" : `MODEL_HTTP_${status}`,
      category: "provider",
      retryable: status === 408 || status === 425 || status === 429 || status >= 500,
      safeMessage: `Model request failed with HTTP ${status}`,
      httpStatus: status,
    };
  }
  if (/timeout/i.test(value.message)) {
    return { code: "AGENT_RUN_TIMEOUT", category: "timeout", retryable: true, safeMessage: "Agent run timed out" };
  }
  if (/fetch failed|network/i.test(value.message)) {
    return { code: "MODEL_NETWORK_FAILED", category: "network", retryable: true, safeMessage: "Model network request failed" };
  }
  if (/Tool agent exceeded max rounds/.test(value.message)) {
    return { code: "AGENT_MAX_ROUNDS_EXCEEDED", category: "internal", retryable: false, safeMessage: "Agent exceeded its round limit" };
  }
  return { code: "INTERNAL_ERROR", category: "internal", retryable: false, safeMessage: "Agent run failed" };
}
