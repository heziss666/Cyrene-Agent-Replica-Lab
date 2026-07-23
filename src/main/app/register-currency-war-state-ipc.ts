import type { CurrencyWarStatePatch } from "../../shared/currency-war-api-types.js";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import type { CurrencyWarGameStateService } from "../currency-war/state/game-state-service.js";

type Handler = (_event: unknown, payload?: unknown) => Promise<unknown>;

export interface CurrencyWarStateIpcMainLike {
  handle(channel: string, handler: Handler): void;
  removeHandler(channel: string): void;
}

const CHANNELS = Object.values(IPC_CHANNELS.currencyWarState);
const ID = /^[A-Za-z0-9_.-]{1,200}$/u;
const PATCH_KEYS = new Set([
  "status", "nodeId", "teamHealth", "gold", "level", "experience", "winStreak",
  "board", "bench", "shop", "inventory", "equipmentAssignments",
  "investmentEnvironment", "investmentStrategies", "advisorState",
  "specialResources", "notes",
]);

export function registerCurrencyWarStateIpc(options: {
  ipcMain: CurrencyWarStateIpcMainLike;
  service: Pick<CurrencyWarGameStateService, "get" | "create" | "update" | "reset" | "validate">;
}): { dispose(): void } {
  for (const channel of CHANNELS) options.ipcMain.removeHandler(channel);

  options.ipcMain.handle(IPC_CHANNELS.currencyWarState.get, async (_event, payload) =>
    options.service.get(parseConversationId(payload)));
  options.ipcMain.handle(IPC_CHANNELS.currencyWarState.create, async (_event, payload) =>
    options.service.create(parseConversationId(payload)));
  options.ipcMain.handle(IPC_CHANNELS.currencyWarState.reset, async (_event, payload) =>
    options.service.reset(parseConversationId(payload)));
  options.ipcMain.handle(IPC_CHANNELS.currencyWarState.validate, async (_event, payload) =>
    options.service.validate(parseConversationId(payload)));
  options.ipcMain.handle(IPC_CHANNELS.currencyWarState.update, async (_event, payload) => {
    const object = exactObject(payload, ["conversationId", "patch"]);
    if (typeof object.conversationId !== "string" || !ID.test(object.conversationId)) invalid();
    const patch = parsePatch(object.patch);
    return options.service.update(object.conversationId, patch);
  });

  return {
    dispose() {
      for (const channel of CHANNELS) options.ipcMain.removeHandler(channel);
    },
  };
}

function parseConversationId(payload: unknown): string {
  const value = exactObject(payload, ["conversationId"]).conversationId;
  if (typeof value !== "string" || !ID.test(value)) invalid();
  return value;
}

function parsePatch(value: unknown): CurrencyWarStatePatch {
  if (!isPlainObject(value)) invalid();
  if (Object.keys(value).some((key) => !PATCH_KEYS.has(key))) invalid();
  return structuredClone(value) as CurrencyWarStatePatch;
}

function exactObject(payload: unknown, keys: string[]): Record<string, unknown> {
  if (!isPlainObject(payload)) invalid();
  const actual = Object.keys(payload);
  if (actual.length !== keys.length || keys.some((key) => !actual.includes(key))) invalid();
  return payload;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(): never {
  throw new Error("Invalid currency war state IPC payload");
}
