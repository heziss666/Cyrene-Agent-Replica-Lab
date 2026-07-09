import { app, BrowserWindow } from "electron";
import path from "node:path";

function getAppRoot(): string {
  return app.getAppPath();
}

function getPreloadPath(): string {
  return path.join(getAppRoot(), "dist", "preload", "index.js");
}

function getRendererHtmlPath(): string {
  return path.join(getAppRoot(), "dist", "renderer", "chat", "index.html");
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    title: "Cyrene Agent Replica Lab",
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.CYRENE_RENDERER_URL) {
    await window.loadURL(process.env.CYRENE_RENDERER_URL);
  } else {
    await window.loadFile(getRendererHtmlPath());
  }

  return window;
}
