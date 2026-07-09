import type { ToolDefinition, ToolSpec } from "./tool-types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.id, tool);
  }

  getById(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getEnabledTools(): ToolDefinition[] {
    return this.getAllTools().filter((tool) => tool.enabled);
  }

  setEnabled(id: string, enabled: boolean): void {
    const tool = this.tools.get(id);
    if (tool) {
      tool.enabled = enabled;
    }
  }

  getEnabledToolSpecs(): ToolSpec[] {
    return this.getEnabledTools().map((tool) => ({
      name: tool.id,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }
}
