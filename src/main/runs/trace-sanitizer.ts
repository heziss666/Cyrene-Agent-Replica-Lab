const REDACTED = "[REDACTED]";
const SECRET_KEY = /token|secret|password|authorization|api.?key|cookie|credential/i;
const SECRET_TEXT = /^(?:Bearer\s+\S{8,}|sk-[A-Za-z0-9_-]{8,})$/i;

export interface TraceSanitizerLimits {
  maxDepth?: number;
  maxArrayItems?: number;
  maxStringLength?: number;
}

export function sanitizeTraceValue(value: unknown, limits: TraceSanitizerLimits = {}): unknown {
  const maxDepth = limits.maxDepth ?? 5;
  const maxArrayItems = limits.maxArrayItems ?? 50;
  const maxStringLength = limits.maxStringLength ?? 2_000;
  function visit(input: unknown, depth: number, key?: string): unknown {
    if (key && SECRET_KEY.test(key)) return REDACTED;
    if (typeof input === "string") {
      if (SECRET_TEXT.test(input.trim())) return REDACTED;
      return input.length <= maxStringLength ? input : `${input.slice(0, maxStringLength)}...`;
    }
    if (depth >= maxDepth && typeof input === "object" && input !== null) return "[TRUNCATED]";
    if (Array.isArray(input)) return input.slice(0, maxArrayItems).map((item) => visit(item, depth + 1));
    if (typeof input !== "object" || input === null) return input;
    const output: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(input).slice(0, 100)) {
      output[childKey] = visit(child, depth + 1, childKey);
    }
    return output;
  }
  return visit(value, 0);
}
