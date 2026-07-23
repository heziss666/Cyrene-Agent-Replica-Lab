import type { CurrencyWarStatePatch } from "../../shared/currency-war-api-types.js";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import type { CurrencyWarGameService } from "../currency-war/games/currency-war-game-service.js";

type Handler = (_event: unknown, payload?: unknown) => Promise<unknown>;
export interface CurrencyWarGamesIpcMainLike {
  handle(channel: string, handler: Handler): void;
  removeHandler(channel: string): void;
}

const CHANNELS = Object.values(IPC_CHANNELS.currencyWarGames);
const ID = /^[A-Za-z0-9_.-]{1,200}$/u;
const PATCH_KEYS = new Set([
  "status", "nodeId", "teamHealth", "gold", "level", "experience", "winStreak",
  "board", "bench", "shop", "inventory", "equipmentAssignments",
  "investmentEnvironment", "investmentStrategies", "advisorState", "notes",
]);

export function registerCurrencyWarGamesIpc(options: {
  ipcMain: CurrencyWarGamesIpcMainLike;
  service: CurrencyWarGameService;
}): { dispose(): void } {
  for (const channel of CHANNELS) options.ipcMain.removeHandler(channel);
  options.ipcMain.handle(IPC_CHANNELS.currencyWarGames.list, async (_event, payload) => {
    noPayload(payload);
    return options.service.list();
  });
  options.ipcMain.handle(IPC_CHANNELS.currencyWarGames.getEditorOptions, async (_event, payload) => {
    noPayload(payload);
    return options.service.getEditorOptions();
  });
  options.ipcMain.handle(IPC_CHANNELS.currencyWarGames.create, async (_event, payload) => {
    if (payload === undefined) return options.service.create();
    const value = exactObject(payload, ["name"]);
    if (typeof value.name !== "string") invalid();
    return options.service.create(value.name);
  });
  for (const [channel, action] of [
    [IPC_CHANNELS.currencyWarGames.get, options.service.get.bind(options.service)],
    [IPC_CHANNELS.currencyWarGames.setActive, options.service.setActive.bind(options.service)],
    [IPC_CHANNELS.currencyWarGames.reset, options.service.reset.bind(options.service)],
    [IPC_CHANNELS.currencyWarGames.remove, options.service.remove.bind(options.service)],
    [IPC_CHANNELS.currencyWarGames.validate, options.service.validate.bind(options.service)],
    [IPC_CHANNELS.currencyWarGames.summarize, options.service.summarize.bind(options.service)],
  ] as const) {
    options.ipcMain.handle(channel, async (_event, payload) => action(parseGameId(payload)));
  }
  options.ipcMain.handle(IPC_CHANNELS.currencyWarGames.rename, async (_event, payload) => {
    const value = exactObject(payload, ["gameId", "name"]);
    if (typeof value.gameId !== "string" || !ID.test(value.gameId) || typeof value.name !== "string") invalid();
    return options.service.rename(value.gameId, value.name);
  });
  options.ipcMain.handle(IPC_CHANNELS.currencyWarGames.update, async (_event, payload) => {
    const value = exactObject(payload, ["gameId", "patch"]);
    if (typeof value.gameId !== "string" || !ID.test(value.gameId)) invalid();
    return options.service.update(value.gameId, parsePatch(value.patch));
  });
  return { dispose: () => CHANNELS.forEach((channel) => options.ipcMain.removeHandler(channel)) };
}

function parseGameId(payload: unknown): string {
  const value = exactObject(payload, ["gameId"]).gameId;
  if (typeof value !== "string" || !ID.test(value)) invalid();
  return value;
}
function parsePatch(value: unknown): CurrencyWarStatePatch {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !PATCH_KEYS.has(key))) invalid();
  return structuredClone(value) as CurrencyWarStatePatch;
}
function exactObject(payload: unknown, keys: string[]): Record<string, unknown> {
  if (!isPlainObject(payload)) invalid();
  const actual = Object.keys(payload);
  if (actual.length !== keys.length || keys.some((key) => !actual.includes(key))) invalid();
  return payload;
}
function noPayload(payload: unknown): void {
  if (payload !== undefined) invalid();
}
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function invalid(): never {
  throw new Error("Invalid currency war games IPC payload");
}
