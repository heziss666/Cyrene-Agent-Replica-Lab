import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { formatAgentEventForTerminal } from "../main/agent/agent-events.js";
import { runToolAgent } from "../main/agent/tool-agent.js";
import { loadPersonaConfig } from "../main/config/persona-config.js";
import {
  buildModelMessages,
  createRuntimePromptComposer,
  createRuntimeToolRegistry,
  loadRuntimeModelConfig,
} from "../main/runtime/agent-runtime.js";
import { openAICompatibleAdapter } from "../main/vendors/openai-compatible.js";
import type { ChatMessage } from "../shared/chat-types.js";

export async function runTerminalChat(): Promise<void> {
  const config = loadRuntimeModelConfig();
  const toolRegistry = createRuntimeToolRegistry();
  const promptComposer = createRuntimePromptComposer();
  const personaConfig = await loadPersonaConfig();
  const rl = readline.createInterface({ input, output });
  let history: ChatMessage[] = [];

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
          messages: buildModelMessages(
            promptComposer.composeSystemPrompt({ styleId: personaConfig.styleId }),
            history,
          ),
          config,
          adapter: openAICompatibleAdapter,
          toolRegistry,
          onEvent: (event) => {
            console.log(formatAgentEventForTerminal(event));
          },
        });
        history = result.messages.filter((message) => message.role !== "system");
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
