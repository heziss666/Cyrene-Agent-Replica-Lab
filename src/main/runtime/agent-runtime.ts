import type { ChatMessage } from "../../shared/chat-types.js";
import { loadLocalEnvFile } from "../config/env-file.js";
import { loadModelConfig, type ModelConfig } from "../config/model-config.js";
import { createPromptComposer, type PromptComposer } from "../prompts/prompt-composer.js";
import { createDefaultToolRegistry } from "../tools/built-in-tools.js";
import type { ToolRegistry } from "../tools/tool-registry.js";

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

export function createRuntimeToolRegistry(): ToolRegistry {
  loadLocalEnvFile();
  return createDefaultToolRegistry();
}
