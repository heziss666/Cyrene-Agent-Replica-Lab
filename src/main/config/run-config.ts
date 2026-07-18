export interface AgentRunConfig { maxConcurrent: number; modelRequestTimeoutMs: number; toolTimeoutMs: number; runTimeoutMs: number }
function positive(env: NodeJS.ProcessEnv, key: string, fallback: number) { const value = Number(env[key] ?? fallback); if (!Number.isInteger(value) || value <= 0) throw new Error(`${key}_MUST_BE_POSITIVE_INTEGER`); return value; }
export function loadAgentRunConfig(env: NodeJS.ProcessEnv = process.env): AgentRunConfig {
  return { maxConcurrent: positive(env, "CYRENE_AGENT_MAX_CONCURRENT_RUNS", 2), modelRequestTimeoutMs: positive(env, "CYRENE_MODEL_REQUEST_TIMEOUT_MS", 120_000), toolTimeoutMs: positive(env, "CYRENE_TOOL_TIMEOUT_MS", 300_000), runTimeoutMs: positive(env, "CYRENE_AGENT_RUN_TIMEOUT_MS", 600_000) };
}
