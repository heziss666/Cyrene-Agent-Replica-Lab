import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import type { TaskScheduler } from "../scheduler/task-scheduler.js";
import { parseScheduledTaskInput, parseScheduledTaskPatch } from "../scheduler/scheduled-task-validation.js";

type Handler = (_event: unknown, payload?: unknown) => Promise<unknown>;

export interface SchedulerIpcMainLike {
  handle(channel: string, handler: Handler): void;
  removeHandler(channel: string): void;
}

const HANDLERS = [
  IPC_CHANNELS.scheduler.listTasks, IPC_CHANNELS.scheduler.createTask,
  IPC_CHANNELS.scheduler.updateTask, IPC_CHANNELS.scheduler.removeTask,
  IPC_CHANNELS.scheduler.setEnabled, IPC_CHANNELS.scheduler.runNow,
  IPC_CHANNELS.scheduler.listRuns, IPC_CHANNELS.scheduler.getRun,
] as const;

export function registerSchedulerIpc(options: {
  ipcMain: SchedulerIpcMainLike;
  scheduler: Pick<TaskScheduler, "snapshot" | "create" | "update" | "remove" | "setEnabled" | "runNow" | "listRuns" | "getRun">;
}): { dispose(): void } {
  for (const channel of HANDLERS) options.ipcMain.removeHandler(channel);
  options.ipcMain.handle(IPC_CHANNELS.scheduler.listTasks, async () => options.scheduler.snapshot());
  options.ipcMain.handle(IPC_CHANNELS.scheduler.createTask, async (_event, payload) =>
    options.scheduler.create(parseInput(payload)));
  options.ipcMain.handle(IPC_CHANNELS.scheduler.updateTask, async (_event, payload) => {
    const value = exact(payload, ["id", "patch"]);
    return options.scheduler.update(id(value.id), parsePatch(value.patch));
  });
  options.ipcMain.handle(IPC_CHANNELS.scheduler.removeTask, async (_event, payload) => {
    await options.scheduler.remove(id(exact(payload, ["id"]).id));
    return { removed: true };
  });
  options.ipcMain.handle(IPC_CHANNELS.scheduler.setEnabled, async (_event, payload) => {
    const value = exact(payload, ["id", "enabled"]);
    if (typeof value.enabled !== "boolean") throw invalid();
    return options.scheduler.setEnabled(id(value.id), value.enabled);
  });
  options.ipcMain.handle(IPC_CHANNELS.scheduler.runNow, async (_event, payload) => ({
    runId: await options.scheduler.runNow(id(exact(payload, ["id"]).id)),
  }));
  options.ipcMain.handle(IPC_CHANNELS.scheduler.listRuns, async (_event, payload) => {
    if (payload === undefined) return options.scheduler.listRuns();
    return options.scheduler.listRuns(id(exact(payload, ["taskId"]).taskId));
  });
  options.ipcMain.handle(IPC_CHANNELS.scheduler.getRun, async (_event, payload) =>
    options.scheduler.getRun(runId(exact(payload, ["id"]).id)));
  return { dispose: () => { for (const channel of HANDLERS) options.ipcMain.removeHandler(channel); } };
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid();
  const record = value as Record<string, unknown>;
  const own = Reflect.ownKeys(record);
  if (own.length !== keys.length || keys.some((key) => !own.includes(key))) throw invalid();
  return record;
}

function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw invalid();
  return value;
}

function runId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(value)) throw invalid();
  return value;
}

function invalid(): Error { return new Error("Invalid scheduler IPC payload"); }

function parseInput(value: unknown) {
  try { return parseScheduledTaskInput(value); } catch { throw invalid(); }
}

function parsePatch(value: unknown) {
  try { return parseScheduledTaskPatch(value); } catch { throw invalid(); }
}
