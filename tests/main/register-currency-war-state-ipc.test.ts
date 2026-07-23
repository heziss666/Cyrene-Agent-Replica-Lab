import { describe, expect, it, vi } from "vitest";
import { registerCurrencyWarStateIpc } from "../../src/main/app/register-currency-war-state-ipc.js";
import { IPC_CHANNELS } from "../../src/shared/ipc-channels.js";

function fakeIpcMain() {
  const handlers = new Map<string, (_event: unknown, payload?: unknown) => Promise<unknown>>();
  return {
    handlers,
    handle: (channel: string, handler: (_event: unknown, payload?: unknown) => Promise<unknown>) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  };
}

function service() {
  const state = { conversationId: "conv_1", gold: 0 };
  return {
    get: vi.fn(async () => state),
    create: vi.fn(async () => state),
    update: vi.fn(async () => ({ state, saved: true, valid: true, issues: [] })),
    reset: vi.fn(async () => state),
    validate: vi.fn(async () => ({ valid: true, issues: [] })),
    getEditorOptions: vi.fn(() => ({ characters: [], equipment: [] })),
  };
}

describe("registerCurrencyWarStateIpc", () => {
  it("routes all operations to the state service", async () => {
    const ipcMain = fakeIpcMain();
    const stateService = service();
    registerCurrencyWarStateIpc({ ipcMain, service: stateService as never });

    await ipcMain.handlers.get(IPC_CHANNELS.currencyWarState.get)!({}, { conversationId: "conv_1" });
    await ipcMain.handlers.get(IPC_CHANNELS.currencyWarState.update)!({}, { conversationId: "conv_1", patch: { gold: 20 } });

    expect(stateService.get).toHaveBeenCalledWith("conv_1");
    expect(stateService.update).toHaveBeenCalledWith("conv_1", { gold: 20 });
    await ipcMain.handlers.get(IPC_CHANNELS.currencyWarState.getEditorOptions)!({});
    expect(stateService.getEditorOptions).toHaveBeenCalledOnce();
  });

  it("rejects extra keys and immutable patch fields", async () => {
    const ipcMain = fakeIpcMain();
    registerCurrencyWarStateIpc({ ipcMain, service: service() as never });
    const update = ipcMain.handlers.get(IPC_CHANNELS.currencyWarState.update)!;

    await expect(update({}, { conversationId: "conv_1", patch: { gold: 1 }, extra: true }))
      .rejects.toThrow("Invalid currency war state IPC payload");
    await expect(update({}, { conversationId: "conv_1", patch: { conversationId: "other" } }))
      .rejects.toThrow("Invalid currency war state IPC payload");
  });

  it("disposes all handlers", () => {
    const ipcMain = fakeIpcMain();
    const runtime = registerCurrencyWarStateIpc({ ipcMain, service: service() as never });
    expect(ipcMain.handlers.size).toBe(6);
    runtime.dispose();
    expect(ipcMain.handlers.size).toBe(0);
  });
});
