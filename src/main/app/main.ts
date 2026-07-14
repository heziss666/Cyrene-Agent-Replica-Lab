import { app, BrowserWindow, ipcMain } from "electron";
import { registerBackgroundMemoryShutdown } from "./background-memory-shutdown.js";
import { createMainWindow } from "./create-window.js";
import { registerChatIpc } from "./register-chat-ipc.js";

async function boot(): Promise<void> {
  await app.whenReady();
  const runtime = await registerChatIpc({ ipcMain });
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

boot().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[electron] failed to start: ${message}`);
  app.quit();
});
