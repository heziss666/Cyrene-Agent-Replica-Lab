import { writeFileAtomically } from "../rag/atomic-file-write.js";
import type { ScheduledTaskRun } from "./scheduled-task-types.js";
import { parseScheduledRun, parseScheduledRunsFile } from "./scheduled-task-validation.js";
import { loadVersioned } from "./scheduled-task-store.js";

export interface ScheduledRunStore {
  load(): Promise<ScheduledTaskRun[]>;
  append(run: ScheduledTaskRun): Promise<void>;
  update(id: string, updater: (run: ScheduledTaskRun) => ScheduledTaskRun): Promise<void>;
  clearTaskHistory(taskId: string): Promise<number>;
  recoverInterrupted(finishedAt: string): Promise<number>;
}

export function createScheduledRunStore(
  filePath: string,
  options: { now?: () => number } = {},
): ScheduledRunStore {
  const now = options.now ?? Date.now;
  let operation: Promise<unknown> = Promise.resolve();

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = operation.then(work, work);
    operation = result.catch(() => undefined);
    return result;
  }

  async function read(): Promise<ScheduledTaskRun[]> {
    return loadVersioned(filePath, now, parseScheduledRunsFile);
  }

  async function persist(runs: readonly ScheduledTaskRun[]): Promise<void> {
    const retained = retainRuns(runs.map(parseScheduledRun));
    await writeFileAtomically(filePath, `${JSON.stringify({ schemaVersion: 1, runs: retained }, null, 2)}\n`);
  }

  return {
    async load() {
      await operation.catch(() => undefined);
      return read();
    },
    append(run) {
      return enqueue(async () => {
        const runs = await read();
        if (runs.some((item) => item.id === run.id)) throw new Error("SCHEDULE_RUN_EXISTS");
        await persist([...runs, parseScheduledRun(run)]);
      });
    },
    update(id, updater) {
      return enqueue(async () => {
        const runs = await read();
        const index = runs.findIndex((run) => run.id === id);
        if (index < 0) throw new Error("SCHEDULE_RUN_NOT_FOUND");
        const next = [...runs];
        next[index] = parseScheduledRun(updater({ ...runs[index], toolCalls: [...runs[index].toolCalls] }));
        await persist(next);
      });
    },
    clearTaskHistory(taskId) {
      return enqueue(async () => {
        const runs = await read();
        const retained = runs.filter((run) => run.taskId !== taskId || run.status === "queued" || run.status === "running");
        const cleared = runs.length - retained.length;
        if (cleared > 0) await persist(retained);
        return cleared;
      });
    },
    recoverInterrupted(finishedAt) {
      return enqueue(async () => {
        const runs = await read();
        let recovered = 0;
        const next = runs.map((run) => {
          if (run.status !== "queued" && run.status !== "running") return run;
          recovered += 1;
          return {
            ...run,
            status: "cancelled_shutdown" as const,
            finishedAt,
            errorCode: "SCHEDULE_PROCESS_INTERRUPTED",
          };
        });
        if (recovered > 0) await persist(next);
        return recovered;
      });
    },
  };
}

function retainRuns(input: readonly ScheduledTaskRun[]): ScheduledTaskRun[] {
  const sorted = [...input].sort(compareRuns);
  const counts = new Map<string, number>();
  const perTask: ScheduledTaskRun[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const run = sorted[index];
    const count = counts.get(run.taskId) ?? 0;
    if (count >= 100) continue;
    counts.set(run.taskId, count + 1);
    perTask.push(run);
  }
  return perTask.reverse().slice(-500);
}

function compareRuns(left: ScheduledTaskRun, right: ScheduledTaskRun): number {
  const leftTime = Date.parse(left.startedAt ?? left.scheduledFor);
  const rightTime = Date.parse(right.startedAt ?? right.scheduledFor);
  return leftTime - rightTime || left.id.localeCompare(right.id);
}
