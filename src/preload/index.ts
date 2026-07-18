import { contextBridge, ipcRenderer } from "electron";
import type { ChatAgentEventPayload, CyreneApi } from "../shared/electron-api.js";
import type { McpApprovalRequestView } from "../shared/mcp-api-types.js";
import { IPC_CHANNELS } from "../shared/ipc-channels.js";

const api: CyreneApi = {
  conversations: {
    list: async () => ipcRenderer.invoke(IPC_CHANNELS.conversations.list),
    create: async () => ipcRenderer.invoke(IPC_CHANNELS.conversations.create),
    get: async (conversationId) => ipcRenderer.invoke(IPC_CHANNELS.conversations.get, { conversationId }),
    setActive: async (conversationId) => ipcRenderer.invoke(IPC_CHANNELS.conversations.setActive, { conversationId }),
    rename: async (conversationId, title) => ipcRenderer.invoke(IPC_CHANNELS.conversations.rename, { conversationId, title }),
    remove: async (conversationId) => ipcRenderer.invoke(IPC_CHANNELS.conversations.remove, { conversationId }),
    setMessagePinned: async (conversationId, messageId, pinned) => ipcRenderer.invoke(
      IPC_CHANNELS.conversations.setMessagePinned,
      { conversationId, messageId, pinned },
    ),
    onChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload);
      ipcRenderer.on(IPC_CHANNELS.conversations.changed, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.conversations.changed, handler);
    },
  },
  chat: {
    sendMessage: async (input) => {
      return ipcRenderer.invoke(IPC_CHANNELS.chat.sendMessage, input);
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
    getStyle: async (conversationId) => {
      return ipcRenderer.invoke(IPC_CHANNELS.persona.getStyle, { conversationId });
    },
    setStyle: async (conversationId, styleId) => {
      return ipcRenderer.invoke(IPC_CHANNELS.persona.setStyle, { conversationId, styleId });
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
  mcp: {
    list: async () => ipcRenderer.invoke(IPC_CHANNELS.mcp.list),
    add: async (config) => ipcRenderer.invoke(IPC_CHANNELS.mcp.add, config),
    update: async (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.mcp.update, { id, patch }),
    remove: async (id) => ipcRenderer.invoke(IPC_CHANNELS.mcp.remove, { id }),
    reconnect: async (id) => ipcRenderer.invoke(IPC_CHANNELS.mcp.reconnect, { id }),
    setEnabled: async (id, enabled) => ipcRenderer.invoke(
      IPC_CHANNELS.mcp.setEnabled,
      { id, enabled },
    ),
    setToolOptions: async (serverId, toolName, options) => ipcRenderer.invoke(
      IPC_CHANNELS.mcp.setToolOptions,
      { serverId, toolName, options },
    ),
    onApprovalRequested: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, request: McpApprovalRequestView) => {
        listener(request);
      };
      ipcRenderer.on(IPC_CHANNELS.mcp.approvalRequest, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.mcp.approvalRequest, handler);
    },
    resolveApproval: async (id, allowed) => ipcRenderer.invoke(
      IPC_CHANNELS.mcp.resolveApproval,
      { id, allowed },
    ),
  },
  scheduler: {
    listTasks: async () => ipcRenderer.invoke(IPC_CHANNELS.scheduler.listTasks),
    createTask: async (input) => ipcRenderer.invoke(IPC_CHANNELS.scheduler.createTask, input),
    updateTask: async (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.scheduler.updateTask, { id, patch }),
    removeTask: async (id) => ipcRenderer.invoke(IPC_CHANNELS.scheduler.removeTask, { id }),
    setEnabled: async (id, enabled) => ipcRenderer.invoke(IPC_CHANNELS.scheduler.setEnabled, { id, enabled }),
    runNow: async (id) => ipcRenderer.invoke(IPC_CHANNELS.scheduler.runNow, { id }),
    listRuns: async (taskId) => ipcRenderer.invoke(
      IPC_CHANNELS.scheduler.listRuns,
      taskId === undefined ? undefined : { taskId },
    ),
    getRun: async (id) => ipcRenderer.invoke(IPC_CHANNELS.scheduler.getRun, { id }),
    onChanged: (listener) => {
      const handler = () => listener();
      ipcRenderer.on(IPC_CHANNELS.scheduler.changed, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.scheduler.changed, handler);
    },
  },
};

contextBridge.exposeInMainWorld("cyrene", api);
