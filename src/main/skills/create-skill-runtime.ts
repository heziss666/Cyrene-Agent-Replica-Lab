import { fileURLToPath } from "node:url";
import { SkillRegistry } from "./skill-registry.js";
import { createSkillSettingsStore } from "./skill-settings-store.js";

export interface CreateSkillRuntimeOptions {
  builtinRoot: string;
  userRoot: string;
  settingsPath: string;
  toolIds: string[];
}

export function defaultBuiltinSkillsRoot(): string {
  return fileURLToPath(new URL("../../../resources/skills/", import.meta.url));
}

export async function createSkillRuntime(options: CreateSkillRuntimeOptions): Promise<{
  registry: SkillRegistry;
}> {
  const registry = new SkillRegistry({
    builtinRoot: options.builtinRoot,
    userRoot: options.userRoot,
    settingsStore: createSkillSettingsStore(options.settingsPath),
    getToolIds: () => [...options.toolIds],
  });
  await registry.initialize();
  return { registry };
}
