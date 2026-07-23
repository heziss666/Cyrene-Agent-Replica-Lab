import { describe, expect, it, vi } from "vitest";
import { registerCurrencyWarGamesIpc } from "../../src/main/app/register-currency-war-games-ipc.js";
import { IPC_CHANNELS } from "../../src/shared/ipc-channels.js";

function setup() {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
  const ipcMain = {
    handle: (channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) =>
      handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  };
  const service = {
    initialize: vi.fn(),
    list: vi.fn(async () => ({ activeGameId: "game-1", games: [], maxGames: 10 })),
    get: vi.fn(async () => ({})),
    create: vi.fn(async () => ({})),
    setActive: vi.fn(async () => ({})),
    rename: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    reset: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})),
    validate: vi.fn(async () => ({})),
    summarize: vi.fn(async () => "summary"),
    getEditorOptions: vi.fn(() => ({ characters: [], equipment: [] })),
    flush: vi.fn(),
  };
  registerCurrencyWarGamesIpc({ ipcMain, service: service as never });
  return { handlers, service };
}

describe("registerCurrencyWarGamesIpc", () => {
  it("registers all eleven channels and forwards exact payloads", async () => {
    const { handlers, service } = setup();
    expect(handlers.size).toBe(11);
    await handlers.get(IPC_CHANNELS.currencyWarGames.rename)!({}, { gameId: "game-1", name: "新名称" });
    await handlers.get(IPC_CHANNELS.currencyWarGames.update)!({}, { gameId: "game-1", patch: { gold: 20 } });
    expect(service.rename).toHaveBeenCalledWith("game-1", "新名称");
    expect(service.update).toHaveBeenCalledWith("game-1", { gold: 20 });
  });

  it("rejects extra keys and immutable patch fields", async () => {
    const { handlers } = setup();
    const update = handlers.get(IPC_CHANNELS.currencyWarGames.update)!;
    await expect(update({}, { gameId: "game-1", patch: { gold: 1 }, extra: true }))
      .rejects.toThrow("Invalid currency war games IPC payload");
    await expect(update({}, { gameId: "game-1", patch: { gameId: "other" } }))
      .rejects.toThrow("Invalid currency war games IPC payload");
  });
});
