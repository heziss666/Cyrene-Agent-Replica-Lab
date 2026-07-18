import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../../src/shared/ipc-channels.js";
import { registerSchedulerIpc } from "../../src/main/app/register-scheduler-ipc.js";

function createIpcMain() {
  const handlers = new Map<string, (_event: unknown, payload?: unknown) => Promise<unknown>>();
  return {
    handlers,
    handle: (channel: string, handler: (_event: unknown, payload?: unknown) => Promise<unknown>) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  };
}

const input = {
  name: "Daily review",
  prompt: "Review the project status",
  schedule: { kind: "interval" as const, every: 1, unit: "days" as const },
  timezone: "Asia/Shanghai",
  missedRunPolicy: "run-once" as const,
  enabled: true,
};

describe("registerSchedulerIpc", () => {
  it("registers scheduler CRUD, run, and history handlers", async () => {
    const ipcMain = createIpcMain();
    const task = { id: "task-1", ...input, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const scheduler = {
      snapshot: vi.fn(() => ({ tasks: [task] })),
      create: vi.fn(async () => task),
      update: vi.fn(async () => task),
      remove: vi.fn(async () => undefined),
      setEnabled: vi.fn(async () => task),
      runNow: vi.fn(async () => "run-1"),
      listRuns: vi.fn(async () => []),
      getRun: vi.fn(async () => undefined),
    };

    registerSchedulerIpc({ ipcMain, scheduler });
    await expect(ipcMain.handlers.get(IPC_CHANNELS.scheduler.listTasks)?.({})).resolves.toEqual({ tasks: [task] });
    await ipcMain.handlers.get(IPC_CHANNELS.scheduler.createTask)?.({}, input);
    await ipcMain.handlers.get(IPC_CHANNELS.scheduler.updateTask)?.({}, { id: "task-1", patch: { name: "New" } });
    await ipcMain.handlers.get(IPC_CHANNELS.scheduler.removeTask)?.({}, { id: "task-1" });
    await ipcMain.handlers.get(IPC_CHANNELS.scheduler.setEnabled)?.({}, { id: "task-1", enabled: false });
    await expect(ipcMain.handlers.get(IPC_CHANNELS.scheduler.runNow)?.({}, { id: "task-1" })).resolves.toEqual({ runId: "run-1" });
    await ipcMain.handlers.get(IPC_CHANNELS.scheduler.listRuns)?.({}, { taskId: "task-1" });
    await ipcMain.handlers.get(IPC_CHANNELS.scheduler.getRun)?.({}, { id: "run-1" });

    expect(scheduler.create).toHaveBeenCalledWith(input);
    expect(scheduler.update).toHaveBeenCalledWith("task-1", { name: "New" });
    expect(scheduler.setEnabled).toHaveBeenCalledWith("task-1", false);
    expect(scheduler.listRuns).toHaveBeenCalledWith("task-1");
  });

  it("rejects extra or malformed payload fields", async () => {
    const ipcMain = createIpcMain();
    const scheduler = {
      snapshot: () => ({ tasks: [] }), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
      setEnabled: vi.fn(), runNow: vi.fn(), listRuns: vi.fn(), getRun: vi.fn(),
    };
    registerSchedulerIpc({ ipcMain, scheduler });

    await expect(ipcMain.handlers.get(IPC_CHANNELS.scheduler.updateTask)?.({}, {
      id: "task-1", patch: { name: "New", secret: "no" },
    })).rejects.toThrow("Invalid scheduler IPC payload");
    await expect(ipcMain.handlers.get(IPC_CHANNELS.scheduler.setEnabled)?.({}, {
      id: "task-1", enabled: "yes",
    })).rejects.toThrow("Invalid scheduler IPC payload");
  });

  it("removes only its own handlers when disposed", () => {
    const ipcMain = createIpcMain();
    const scheduler = {
      snapshot: () => ({ tasks: [] }), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
      setEnabled: vi.fn(), runNow: vi.fn(), listRuns: vi.fn(), getRun: vi.fn(),
    };
    const runtime = registerSchedulerIpc({ ipcMain, scheduler });
    expect(ipcMain.handlers.size).toBe(8);
    runtime.dispose();
    expect(ipcMain.handlers.size).toBe(0);
  });
});
