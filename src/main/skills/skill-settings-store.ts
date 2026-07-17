import { readFile, rename } from "node:fs/promises";
import { writeFileAtomically } from "../rag/atomic-file-write.js";

const SCHEMA_VERSION = 1;

export interface SkillSettingsStore {
  load(): Promise<Record<string, boolean>>;
  save(enabledById: Record<string, boolean>): Promise<void>;
}

function parseSettings(value: unknown): Record<string, boolean> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("SKILL_SETTINGS_INVALID");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== SCHEMA_VERSION) throw new Error("SKILL_SETTINGS_INVALID");
  const enabled = record.enabledById;
  if (typeof enabled !== "object" || enabled === null || Array.isArray(enabled)) {
    throw new Error("SKILL_SETTINGS_INVALID");
  }
  const result: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
  for (const [id, state] of Object.entries(enabled)) {
    if (typeof state !== "boolean") throw new Error("SKILL_SETTINGS_INVALID");
    result[id] = state;
  }
  return result;
}

export function createSkillSettingsStore(
  filePath: string,
  options: { now?: () => number } = {},
): SkillSettingsStore {
  const now = options.now ?? Date.now;
  return {
    async load() {
      try {
        return parseSettings(JSON.parse(await readFile(filePath, "utf8")) as unknown);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
        try {
          await rename(filePath, `${filePath}.corrupt-${now()}`);
        } catch {
          // Recovery still uses defaults when quarantine itself is unavailable.
        }
        return {};
      }
    },
    async save(enabledById) {
      await writeFileAtomically(filePath, `${JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        enabledById,
      }, null, 2)}\n`);
    },
  };
}
