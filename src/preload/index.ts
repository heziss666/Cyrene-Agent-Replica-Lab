import { contextBridge, ipcRenderer } from "electron";
import type { ChatAgentEventPayload, CyreneApi } from "../shared/electron-api.js";
import { IPC_CHANNELS } from "../shared/ipc-channels.js";

const api: CyreneApi = {
  chat: {
    sendMessage: async (text) => {
      return ipcRenderer.invoke(IPC_CHANNELS.chat.sendMessage, text);
    },
    clearSession: async () => {
      return ipcRenderer.invoke(IPC_CHANNELS.chat.clearSession);
    },
    onAgentEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: ChatAgentEventPayload) => {
        listener(payload);
      };

      ipcRenderer.on(IPC_CHANNELS.chat.agentEvent, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.chat.agentEvent, handler);
      };
    },
  },
  persona: {
    getStyle: async () => {
      return ipcRenderer.invoke(IPC_CHANNELS.persona.getStyle);
    },
    setStyle: async (styleId) => {
      return ipcRenderer.invoke(IPC_CHANNELS.persona.setStyle, styleId);
    },
  },
};

contextBridge.exposeInMainWorld("cyrene", api);
