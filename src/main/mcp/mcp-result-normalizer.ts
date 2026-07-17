export const MCP_TOOL_RESULT_MAX_CHARS = 40_000;

export function normalizeMcpToolResult(value: unknown): string {
  const record = isRecord(value) ? value : {};
  const sections: string[] = [];
  if (Array.isArray(record.content)) {
    for (const block of record.content) {
      const rendered = renderBlock(block);
      if (rendered) sections.push(rendered);
    }
  }
  if (record.structuredContent !== undefined) {
    sections.push(`[structured]\n${safeJson(record.structuredContent)}`);
  }
  if (sections.length === 0) sections.push("[MCP_EMPTY_RESULT]");
  let output = sections.join("\n");
  if (record.isError === true) output = `[MCP_TOOL_ERROR]\n${output}`;
  if (output.length > MCP_TOOL_RESULT_MAX_CHARS) {
    output = `${output.slice(0, MCP_TOOL_RESULT_MAX_CHARS)}\n[MCP_RESULT_TRUNCATED]`;
  }
  return output;
}

function renderBlock(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  if (value.type === "text" && typeof value.text === "string") return value.text;
  if (value.type === "resource_link") {
    const name = typeof value.name === "string" ? value.name : "resource";
    const uri = typeof value.uri === "string" ? value.uri : "unknown";
    const description = typeof value.description === "string" ? ` - ${value.description}` : "";
    return `[resource] ${name}: ${uri}${description}`;
  }
  if (value.type === "image" || value.type === "audio") {
    const mime = typeof value.mimeType === "string" ? value.mimeType : "unknown";
    const size = typeof value.data === "string" ? value.data.length : 0;
    return `[${value.type}] mime=${mime} encodedChars=${size}`;
  }
  if (value.type === "resource" && isRecord(value.resource)) {
    const uri = typeof value.resource.uri === "string" ? value.resource.uri : "unknown";
    return `[resource] ${uri}`;
  }
  return `[unsupported MCP content: ${value.type}]`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable structured content]";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
