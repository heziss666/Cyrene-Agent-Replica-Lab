import type { SkillsSnapshot } from "../../shared/skill-api-types.js";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import type { SkillRegistry } from "../skills/skill-registry.js";

type Handler = (_event: unknown, payload?: unknown) => Promise<unknown>;

export interface SkillsIpcMainLike {
  handle(channel: string, handler: Handler): void;
  removeHandler(channel: string): void;
}

export interface SkillsIpcRuntime {
  dispose(): void;
}

export interface RegisterSkillsIpcOptions {
  ipcMain: SkillsIpcMainLike;
  registry: Pick<SkillRegistry, "snapshot" | "setEnabled" | "reload">;
}

const CHANNELS = Object.values(IPC_CHANNELS.skills);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const activeRegistrations = new WeakMap<SkillsIpcMainLike, object>();

function toRendererSnapshot(
  snapshot: ReturnType<RegisterSkillsIpcOptions["registry"]["snapshot"]>,
): SkillsSnapshot {
  return {
    skills: snapshot.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      ...(skill.version === undefined ? {} : { version: skill.version }),
      requiredTools: [...skill.requiredTools],
      source: skill.source,
      references: skill.references.map((reference) => reference.name),
      defaultEnabled: skill.defaultEnabled,
      enabled: skill.enabled,
      available: skill.available,
      unavailableReasons: [...skill.unavailableReasons],
    })),
    diagnostics: snapshot.diagnostics.map((item) => ({
      source: item.source,
      code: item.code,
      message: item.message,
    })),
  };
}

function parseSetEnabled(payload: unknown): { id: string; enabled: boolean } {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Invalid skills IPC payload");
  }
  const prototype = Object.getPrototypeOf(payload);
  const keys = Reflect.ownKeys(payload);
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.length !== 2
    || !keys.includes("id")
    || !keys.includes("enabled")) {
    throw new Error("Invalid skills IPC payload");
  }
  const id = Object.getOwnPropertyDescriptor(payload, "id")?.value;
  const enabled = Object.getOwnPropertyDescriptor(payload, "enabled")?.value;
  if (typeof id !== "string" || !ID_PATTERN.test(id) || typeof enabled !== "boolean") {
    throw new Error("Invalid skills IPC payload");
  }
  return { id, enabled };
}

export function registerSkillsIpc(options: RegisterSkillsIpcOptions): SkillsIpcRuntime {
  const token = {};
  activeRegistrations.set(options.ipcMain, token);
  for (const channel of CHANNELS) options.ipcMain.removeHandler(channel);

  const snapshot = (): SkillsSnapshot => toRendererSnapshot(options.registry.snapshot());
  options.ipcMain.handle(IPC_CHANNELS.skills.list, async () => snapshot());
  options.ipcMain.handle(IPC_CHANNELS.skills.setEnabled, async (_event, payload) => {
    const input = parseSetEnabled(payload);
    await options.registry.setEnabled(input.id, input.enabled);
    return snapshot();
  });
  options.ipcMain.handle(IPC_CHANNELS.skills.reload, async () => {
    await options.registry.reload();
    return snapshot();
  });

  return {
    dispose() {
      if (activeRegistrations.get(options.ipcMain) !== token) return;
      activeRegistrations.delete(options.ipcMain);
      for (const channel of CHANNELS) options.ipcMain.removeHandler(channel);
    },
  };
}
