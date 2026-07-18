import { describe, expect, it, vi } from "vitest";
import { registerRunsIpc } from "../../src/main/app/register-runs-ipc.js";
import { IPC_CHANNELS } from "../../src/shared/ipc-channels.js";

function setup() {
  const handlers = new Map<string, (_event: unknown, payload?: unknown) => Promise<unknown>>();
  const ipcMain = {
    handle: (channel: string, handler: (_event: unknown, payload?: unknown) => Promise<unknown>) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  };
  const manager = {
    list: vi.fn(async () => []),
    get: vi.fn(async (id: string) => ({
      schemaVersion: 1 as const,
      runId: id,
      source: "chat" as const,
      status: "succeeded" as const,
      queuedAt: "2026-07-18T00:00:00.000Z",
      roundsUsed: 1,
      modelCallCount: 1,
      toolCallCount: 0,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, source: "provider" as const },
      events: [],
    })),
    cancel: vi.fn(async () => true),
    remove: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  };
  const selectExportPath = vi.fn(async () => "C:/safe/run.json");
  const writeExport = vi.fn(async () => undefined);
  registerRunsIpc({ ipcMain, manager, selectExportPath, writeExport });
  return { handlers, manager, selectExportPath, writeExport };
}

describe("registerRunsIpc", () => {
  it("validates exact run id payloads", async () => {
    const { handlers, manager } = setup();
    const cancel = handlers.get(IPC_CHANNELS.runs.cancel)!;

    await expect(cancel({}, { runId: "run_123" })).resolves.toEqual({ cancelled: true });
    await expect(cancel({}, { runId: "run_123", path: "C:/secret" })).rejects.toThrow(
      "Invalid runs IPC payload",
    );
    expect(manager.cancel).toHaveBeenCalledWith("run_123");
  });

  it("exports through a main-selected path only", async () => {
    const { handlers, selectExportPath, writeExport } = setup();
    const exportRun = handlers.get(IPC_CHANNELS.runs.export)!;

    await expect(exportRun({}, { runId: "run_abc" })).resolves.toEqual({ exported: true });
    expect(selectExportPath).toHaveBeenCalledWith("run_abc");
    expect(writeExport).toHaveBeenCalledWith(
      "C:/safe/run.json",
      expect.stringContaining('"runId": "run_abc"'),
    );
  });

  it("removes every registered handler on dispose", () => {
    const { handlers } = setup();
    expect(handlers.size).toBe(6);
  });
});
