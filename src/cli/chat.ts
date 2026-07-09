import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { formatAgentEventForTerminal } from "../main/agent/agent-events.js";
import { runToolAgent } from "../main/agent/tool-agent.js";
import { loadLocalEnvFile } from "../main/config/env-file.js";
import { loadModelConfig } from "../main/config/model-config.js";
import type { ModelConfig } from "../main/config/model-config.js";
import { createDefaultToolRegistry } from "../main/tools/built-in-tools.js";
import type { ToolRegistry } from "../main/tools/tool-registry.js";
import { openAICompatibleAdapter } from "../main/vendors/openai-compatible.js";
import type { ChatMessage } from "../shared/chat-types.js";

export const SYSTEM_PROMPT = [
  "You are Cyrene Replica Lab, a minimal learning agent.",
  "Answer clearly and briefly.",
  "When explaining technical ideas, use beginner-friendly wording.",
].join("\n");

export function createInitialHistory(): ChatMessage[] {
  return [{ role: "system", content: SYSTEM_PROMPT }];
}

export function loadRuntimeModelConfig(): ModelConfig {
  loadLocalEnvFile();
  return loadModelConfig();
}

export function createRuntimeToolRegistry(): ToolRegistry {
  return createDefaultToolRegistry();
}

export async function runTerminalChat(): Promise<void> {
  const config = loadRuntimeModelConfig();
  const toolRegistry = createRuntimeToolRegistry();
  const rl = readline.createInterface({ input, output });
  let history = createInitialHistory();

  console.log("Cyrene Agent Replica Lab - terminal chat");
  console.log("Type /exit to quit.");

  try {
    while (true) {
      const text = (await rl.question("\nYou> ")).trim();
      if (!text) continue;
      if (text === "/exit") break;

      history.push({ role: "user", content: text });

      try {
        const result = await runToolAgent({
          messages: history,
          config,
          adapter: openAICompatibleAdapter,
          toolRegistry,
          onEvent: (event) => {
            console.log(formatAgentEventForTerminal(event));
          },
        });
        history = result.messages;
        console.log(`\nAgent> ${result.reply}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\n[error] ${message}`);
      }
    }
  } finally {
    rl.close();
  }
}

function isDirectCliRun(): boolean {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isDirectCliRun()) {
  runTerminalChat().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[fatal] ${message}`);
    process.exitCode = 1;
  });
}
