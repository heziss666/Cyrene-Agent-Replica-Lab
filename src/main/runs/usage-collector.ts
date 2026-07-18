import type { AgentRunUsage } from "./agent-run-types.js";
export interface UsageInput { inputTokens: number; outputTokens: number; source: "provider" | "estimated" }
export function createUsageCollector() {
  let inputTokens = 0; let outputTokens = 0; let estimated = false;
  return {
    add(value: UsageInput) { inputTokens += Math.max(0, Math.ceil(value.inputTokens)); outputTokens += Math.max(0, Math.ceil(value.outputTokens)); estimated ||= value.source === "estimated"; },
    snapshot(): AgentRunUsage { return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, source: estimated ? "estimated" : "provider" }; },
  };
}
