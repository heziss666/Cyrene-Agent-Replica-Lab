import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";
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
import { buildSkillCatalog } from "../main/skills/skill-catalog.js";
import { parseSkillCommand } from "../main/skills/skill-command.js";
import {
  createSkillRuntime,
  defaultBuiltinSkillsRoot,
} from "../main/skills/create-skill-runtime.js";
import { registerSkillTools } from "../main/skills/skill-tools.js";

export async function runTerminalChat(): Promise<void> {
  const config = loadRuntimeModelConfig();
  const toolRegistry = createRuntimeToolRegistry();
  const userData = join(process.env.APPDATA ?? homedir(), "cyrene-agent-replica-lab");
  const skillRuntime = await createSkillRuntime({
    builtinRoot: defaultBuiltinSkillsRoot(),
    userRoot: join(userData, "skills"),
    settingsPath: join(userData, "skills-settings.json"),
    toolIds: toolRegistry.getAllTools().map((tool) => tool.id),
  });
  registerSkillTools(toolRegistry, skillRuntime.registry);
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

      const command = parseSkillCommand(text, skillRuntime.registry.list());
      if (command.kind === "error") {
        console.error(`\n[error] ${command.code}`);
        continue;
      }
      const userText = command.text;
      const manualSkillPrompt = command.kind === "activated"
        ? `## Activated Skill: ${command.skillId}\n\n${await skillRuntime.registry.readBody(command.skillId)}`
        : "";
      if (command.kind === "activated") {
        console.log(formatAgentEventForTerminal({
          type: "skill_activated",
          skillId: command.skillId,
        }));
      }
      history.push({ role: "user", content: userText });

      try {
        const result = await runToolAgent({
          messages: buildModelMessages([
            promptComposer.composeSystemPrompt({ styleId: personaConfig.styleId }),
            buildSkillCatalog(skillRuntime.registry.list()),
            manualSkillPrompt,
          ].filter(Boolean).join("\n\n---\n\n"), history),
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
