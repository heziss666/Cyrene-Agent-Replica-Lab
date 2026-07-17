import type { ToolDefinition, ToolSpec } from "./tool-types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): boolean {
    if (this.tools.has(tool.id)) return false;
    this.tools.set(tool.id, tool);
    return true;
  }

  unregister(id: string): boolean {
    return this.tools.delete(id);
  }

  unregisterByOwner(ownerId: string): number {
    let removed = 0;
    for (const [id, tool] of this.tools) {
      if (tool.metadata?.ownerId !== ownerId) continue;
      this.tools.delete(id);
      removed += 1;
    }
    return removed;
  }

  snapshot(): ToolRegistry {
    const snapshot = new ToolRegistry();
    for (const tool of this.tools.values()) {
      snapshot.register({
        ...tool,
        ...(tool.metadata ? { metadata: { ...tool.metadata } } : {}),
      });
    }
    return snapshot;
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
