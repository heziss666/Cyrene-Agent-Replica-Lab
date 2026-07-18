import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import type { AgentRunManager } from "../runs/agent-run-manager.js";

type Handler = (_event: unknown, payload?: unknown) => Promise<unknown>;

export interface RunsIpcMainLike {
  handle(channel: string, handler: Handler): void;
  removeHandler(channel: string): void;
}

const HANDLERS = [
  IPC_CHANNELS.runs.list,
  IPC_CHANNELS.runs.get,
  IPC_CHANNELS.runs.cancel,
  IPC_CHANNELS.runs.remove,
  IPC_CHANNELS.runs.clear,
  IPC_CHANNELS.runs.export,
] as const;

export function registerRunsIpc(options: {
  ipcMain: RunsIpcMainLike;
  manager: Pick<AgentRunManager, "list" | "get" | "cancel" | "remove" | "clear">;
  selectExportPath: (runId: string) => Promise<string | undefined>;
  writeExport: (path: string, content: string) => Promise<void>;
}): { dispose(): void } {
  for (const channel of HANDLERS) options.ipcMain.removeHandler(channel);
  options.ipcMain.handle(IPC_CHANNELS.runs.list, async (_event, payload) => {
    requireUndefined(payload);
    return options.manager.list();
  });
  options.ipcMain.handle(IPC_CHANNELS.runs.get, async (_event, payload) =>
    options.manager.get(parseRunId(payload)));
  options.ipcMain.handle(IPC_CHANNELS.runs.cancel, async (_event, payload) => ({
    cancelled: await options.manager.cancel(parseRunId(payload)),
  }));
  options.ipcMain.handle(IPC_CHANNELS.runs.remove, async (_event, payload) => {
    await options.manager.remove(parseRunId(payload));
    return { removed: true };
  });
  options.ipcMain.handle(IPC_CHANNELS.runs.clear, async (_event, payload) => {
    requireUndefined(payload);
    await options.manager.clear();
    return { cleared: true };
  });
  options.ipcMain.handle(IPC_CHANNELS.runs.export, async (_event, payload) => {
    const runId = parseRunId(payload);
    const record = await options.manager.get(runId);
    if (!record) throw new Error("AGENT_RUN_NOT_FOUND");
    const path = await options.selectExportPath(runId);
    if (!path) return { exported: false };
    await options.writeExport(path, `${JSON.stringify(record, null, 2)}\n`);
    return { exported: true };
  });
  return {
    dispose() {
      for (const channel of HANDLERS) options.ipcMain.removeHandler(channel);
    },
  };
}

function parseRunId(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw invalid();
  const record = payload as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (keys.length !== 1 || keys[0] !== "runId"
    || typeof record.runId !== "string" || !/^run_[A-Za-z0-9_.-]{1,200}$/u.test(record.runId)) {
    throw invalid();
  }
  return record.runId;
}

function requireUndefined(payload: unknown): void {
  if (payload !== undefined) throw invalid();
}

function invalid(): Error {
  return new Error("Invalid runs IPC payload");
}
