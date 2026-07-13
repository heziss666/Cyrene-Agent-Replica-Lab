import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isStyleId, type StyleId } from "../../shared/persona-types.js";
import { writeFileAtomically } from "../rag/atomic-file-write.js";

const PERSONA_CONFIG_SCHEMA_VERSION = 1;

export interface PersonaConfig {
  styleId: StyleId;
}

export function defaultPersonaConfigPath(homeDir = homedir()): string {
  return join(homeDir, ".cyrene-agent-replica-lab", "persona.json");
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOENT";
}

function parsePersonaConfig(content: string): PersonaConfig {
  const parsed = JSON.parse(content) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("root must be an object");
  }

  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== PERSONA_CONFIG_SCHEMA_VERSION) {
    throw new Error(`schemaVersion must be ${PERSONA_CONFIG_SCHEMA_VERSION}`);
  }
  if (!isStyleId(record.styleId)) {
    throw new Error("invalid style");
  }
  return { styleId: record.styleId };
}

export async function loadPersonaConfig(
  filePath = defaultPersonaConfigPath(),
  logger: (message: string) => void = console.warn,
): Promise<PersonaConfig> {
  try {
    return parsePersonaConfig(await readFile(filePath, "utf8"));
  } catch (error) {
    if (!isMissingFile(error)) {
      const message = error instanceof Error ? error.message : String(error);
      logger(`[persona config] using default style: ${message}`);
    }
    return { styleId: "default" };
  }
}

export async function savePersonaConfig(
  filePath: string,
  config: PersonaConfig,
): Promise<void> {
  const content = `${JSON.stringify({
    schemaVersion: PERSONA_CONFIG_SCHEMA_VERSION,
    styleId: config.styleId,
  }, null, 2)}\n`;
  await writeFileAtomically(filePath, content);
}
