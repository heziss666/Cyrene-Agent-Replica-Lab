import { app, BrowserWindow, ipcMain } from "electron";
import { registerBackgroundMemoryShutdown } from "./background-memory-shutdown.js";
import { createMainWindow } from "./create-window.js";
import { registerChatIpc } from "./register-chat-ipc.js";
import {
  combineIpcShutdownRuntimes,
  registerMemoryIpc,
} from "./register-memory-ipc.js";
import { createMemoryGovernanceService } from "../memory/memory-governance.js";
import { createMemoryStore } from "../memory/memory-store.js";

async function boot(): Promise<void> {
  await app.whenReady();
  const memoryStore = createMemoryStore();
  const chatRuntime = await registerChatIpc({ ipcMain, memoryStore });
  const memoryRuntime = registerMemoryIpc({
    ipcMain,
    governance: createMemoryGovernanceService({ store: memoryStore }),
    afterRestoreL2: async (id) => {
      await chatRuntime.inspectRestoredMemory?.(id);
    },
  });
  const runtime = combineIpcShutdownRuntimes(chatRuntime, memoryRuntime);
  registerBackgroundMemoryShutdown({ app, runtime });
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

boot().catch(() => {
  console.error("[electron] failed to start");
  app.quit();
});
