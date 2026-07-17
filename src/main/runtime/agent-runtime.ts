import type { ChatMessage } from "../../shared/chat-types.js";
import { loadLocalEnvFile } from "../config/env-file.js";
import { loadModelConfig, type ModelConfig } from "../config/model-config.js";
import { createPromptComposer, type PromptComposer } from "../prompts/prompt-composer.js";
import { createDefaultToolRegistry } from "../tools/built-in-tools.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import {
  registerSkillTools,
  type SkillToolRegistry,
} from "../skills/skill-tools.js";

export function createRuntimePromptComposer(): PromptComposer {
  return createPromptComposer();
}

export function buildModelMessages(
  systemPrompt: string,
  history: ChatMessage[],
): ChatMessage[] {
  return [{ role: "system", content: systemPrompt }, ...history];
}

export function loadRuntimeModelConfig(): ModelConfig {
  loadLocalEnvFile();
  return loadModelConfig();
}

export function createRuntimeToolRegistry(
  skillRegistry?: SkillToolRegistry,
): ToolRegistry {
  loadLocalEnvFile();
  const registry = createDefaultToolRegistry();
  if (skillRegistry) registerSkillTools(registry, skillRegistry);
  return registry;
}
