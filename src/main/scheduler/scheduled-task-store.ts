import { readFile, rename } from "node:fs/promises";
import { writeFileAtomically } from "../rag/atomic-file-write.js";
import type { ScheduledTask } from "./scheduled-task-types.js";
import { parseScheduledTasksFile } from "./scheduled-task-validation.js";

export interface ScheduledTaskStore {
  load(): Promise<ScheduledTask[]>;
  save(tasks: readonly ScheduledTask[]): Promise<void>;
}

export function createScheduledTaskStore(
  filePath: string,
  options: { now?: () => number } = {},
): ScheduledTaskStore {
  const now = options.now ?? Date.now;
  return {
    async load() {
      return loadVersioned(filePath, now, parseScheduledTasksFile);
    },
    async save(tasks) {
      const parsed = parseScheduledTasksFile({ schemaVersion: 1, tasks });
      await writeFileAtomically(filePath, `${JSON.stringify({ schemaVersion: 1, tasks: parsed }, null, 2)}\n`);
    },
  };
}

export async function loadVersioned<T>(
  filePath: string,
  now: () => number,
  parse: (value: unknown) => T[],
): Promise<T[]> {
  try {
    return parse(JSON.parse(await readFile(filePath, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    try { await rename(filePath, `${filePath}.corrupt-${now()}`); } catch { /* Use defaults. */ }
    return [];
  }
}
