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
  memory: {
    getSnapshot: async () => {
      return ipcRenderer.invoke(IPC_CHANNELS.memory.getSnapshot);
    },
    updateProfileField: async (input) => {
      return ipcRenderer.invoke(IPC_CHANNELS.memory.updateProfileField, input);
    },
    updateL2: async (input) => {
      return ipcRenderer.invoke(IPC_CHANNELS.memory.updateL2, input);
    },
    deleteProfileField: async (input) => {
      return ipcRenderer.invoke(IPC_CHANNELS.memory.deleteProfileField, input);
    },
    deleteL2: async (id) => {
      return ipcRenderer.invoke(IPC_CHANNELS.memory.deleteL2, id);
    },
    setL2Pinned: async (input) => {
      return ipcRenderer.invoke(IPC_CHANNELS.memory.setPinned, input);
    },
    setL2Enabled: async (input) => {
      return ipcRenderer.invoke(IPC_CHANNELS.memory.setEnabled, input);
    },
    restoreL2: async (id) => {
      return ipcRenderer.invoke(IPC_CHANNELS.memory.restoreL2, id);
    },
    clearLayer: async (layer) => {
      return ipcRenderer.invoke(IPC_CHANNELS.memory.clearLayer, layer);
    },
    getAuditReport: async () => {
      return ipcRenderer.invoke(IPC_CHANNELS.memory.getAuditReport);
    },
    runMaintenance: async () => {
      return ipcRenderer.invoke(IPC_CHANNELS.memory.runMaintenance);
    },
  },
  skills: {
    list: async () => {
      return ipcRenderer.invoke(IPC_CHANNELS.skills.list);
    },
    setEnabled: async (id, enabled) => {
      return ipcRenderer.invoke(IPC_CHANNELS.skills.setEnabled, { id, enabled });
    },
    reload: async () => {
      return ipcRenderer.invoke(IPC_CHANNELS.skills.reload);
    },
  },
};

contextBridge.exposeInMainWorld("cyrene", api);
