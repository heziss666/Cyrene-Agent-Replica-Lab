import { describe, expect, it, vi } from "vitest";
import { registerSkillsIpc } from "../../src/main/app/register-skills-ipc.js";
import { IPC_CHANNELS } from "../../src/shared/ipc-channels.js";

function fakeIpcMain() {
  const handlers = new Map<string, (_event: unknown, payload?: unknown) => Promise<unknown>>();
  return {
    handlers,
    removed: [] as string[],
    handle(channel: string, handler: (_event: unknown, payload?: unknown) => Promise<unknown>) {
      handlers.set(channel, handler);
    },
    removeHandler(channel: string) {
      handlers.delete(channel);
      this.removed.push(channel);
    },
  };
}

function registry() {
  return {
    snapshot: vi.fn(() => ({
      skills: [{
        id: "tutor",
        name: "Tutor",
        description: "Teach the project.",
        version: "1.0.0",
        requiredTools: ["search_knowledge"],
        source: "builtin" as const,
        rootPath: "C:/secret/root",
        bodyPath: "C:/secret/root/SKILL.md",
        references: [{ name: "guide.md", path: "C:/secret/guide.md", sizeBytes: 10 }],
        defaultEnabled: true,
        enabled: true,
        available: true,
        unavailableReasons: [],
      }],
      diagnostics: [{ source: "user" as const, path: "C:/secret/bad", code: "SKILL_ID_INVALID", message: "bad" }],
    })),
    setEnabled: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
  };
}

describe("registerSkillsIpc", () => {
  it("lists a path-free renderer snapshot", async () => {
    const ipcMain = fakeIpcMain();
    const skills = registry();
    registerSkillsIpc({ ipcMain, registry: skills });

    const result = await ipcMain.handlers.get(IPC_CHANNELS.skills.list)!({});

    expect(result).toEqual({
      skills: [expect.objectContaining({
        id: "tutor",
        references: ["guide.md"],
      })],
      diagnostics: [{ source: "user", code: "SKILL_ID_INVALID", message: "bad" }],
    });
    expect(JSON.stringify(result)).not.toContain("C:/secret");
  });

  it("validates set-enabled payloads exactly", async () => {
    const ipcMain = fakeIpcMain();
    const skills = registry();
    registerSkillsIpc({ ipcMain, registry: skills });
    const setEnabled = ipcMain.handlers.get(IPC_CHANNELS.skills.setEnabled)!;

    await expect(setEnabled({}, { id: "tutor", enabled: false })).resolves.toBeDefined();
    expect(skills.setEnabled).toHaveBeenCalledWith("tutor", false);
    await expect(setEnabled({}, { id: "tutor", enabled: true, path: "C:/secret" }))
      .rejects.toThrow("Invalid skills IPC payload");
    await expect(setEnabled({}, { id: "INVALID", enabled: true }))
      .rejects.toThrow("Invalid skills IPC payload");
  });

  it("reloads fixed roots and disposes all handlers", async () => {
    const ipcMain = fakeIpcMain();
    const skills = registry();
    const runtime = registerSkillsIpc({ ipcMain, registry: skills });

    await ipcMain.handlers.get(IPC_CHANNELS.skills.reload)!({});
    expect(skills.reload).toHaveBeenCalledOnce();
    runtime.dispose();
    expect(ipcMain.handlers.size).toBe(0);
  });
});
