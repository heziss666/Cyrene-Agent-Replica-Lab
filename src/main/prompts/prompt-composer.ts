import { fileURLToPath } from "node:url";
import {
  STYLE_OPTIONS,
  getStyleOption,
  type StyleId,
  type StyleTransition,
} from "../../shared/persona-types.js";
import {
  createFilePromptReader,
  loadRequiredPrompt,
  type PromptReader,
} from "./prompt-loader.js";

const SEPARATOR = "\n\n---\n\n";

export interface PromptComposer {
  composeSystemPrompt(input: {
    styleId: StyleId;
    transition?: StyleTransition;
  }): string;
}

export interface CreatePromptComposerOptions {
  resourceDir?: string;
  styleResourceDir?: string;
  readPrompt?: PromptReader;
}

export function defaultCurrencyWarPromptDir(): string {
  return fileURLToPath(
    new URL("../../../resources/currency-war/prompts/", import.meta.url),
  );
}

export function defaultCyrenePromptDir(): string {
  return fileURLToPath(new URL("../../../resources/cyrene/prompts/", import.meta.url));
}

function buildTransitionPrompt(transition: StyleTransition): string {
  const from = getStyleOption(transition.from).label;
  const to = getStyleOption(transition.to).label;
  return [
    "【本轮内部风格切换提醒】",
    `回复风格已从“${from}”切换为“${to}”。`,
    "继续理解并使用此前对话内容，但从本轮开始遵守新的回复风格。",
    "不要声称丢失了记忆，不要重新进行自我介绍。",
  ].join("\n");
}

export function createPromptComposer(
  options: CreatePromptComposerOptions = {},
): PromptComposer {
  const systemReader = createFilePromptReader(
    options.resourceDir ?? defaultCurrencyWarPromptDir(),
  );
  const styleReader = createFilePromptReader(
    options.styleResourceDir ?? defaultCyrenePromptDir(),
  );
  const readPrompt = options.readPrompt ?? ((path: string) =>
    path.startsWith("styles/") ? styleReader(path) : systemReader(path)
  );
  const core = loadRequiredPrompt("system.md", readPrompt);
  const styles = new Map<StyleId, string>(
    STYLE_OPTIONS.map((option) => [
      option.id,
      loadRequiredPrompt(`styles/${option.file}`, readPrompt),
    ]),
  );

  return {
    composeSystemPrompt({ styleId, transition }) {
      const parts = [core, styles.get(styleId)!];
      if (transition) parts.push(buildTransitionPrompt(transition));
      return parts.join(SEPARATOR);
    },
  };
}
