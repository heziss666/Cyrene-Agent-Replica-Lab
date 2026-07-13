import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type PromptReader = (relativePath: string) => string;

export function createFilePromptReader(resourceDir: string): PromptReader {
  return (relativePath) => readFileSync(resolve(resourceDir, relativePath), "utf8");
}

export function loadRequiredPrompt(
  relativePath: string,
  readPrompt: PromptReader,
): string {
  let content = "";
  try {
    content = readPrompt(relativePath).trim();
  } catch {
    // Convert file-system details into one stable configuration error.
  }

  if (!content) {
    throw new Error(`Required prompt file is missing or empty: ${relativePath}`);
  }
  return content;
}
