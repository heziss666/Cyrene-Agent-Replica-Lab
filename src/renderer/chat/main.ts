import type { CyreneApi } from "../../shared/electron-api.js";
import {
  STYLE_OPTIONS,
  isStyleId,
  type StyleId,
} from "../../shared/persona-types.js";
import {
  formatRendererErrorMessage,
  formatRendererEventPayload,
} from "./renderer-events.js";
import {
  changeSelectedStyle,
  loadSelectedStyle,
} from "./style-selector.js";
import { mountMemoryView } from "./memory-view.js";
import { mountSkillsView } from "./skills-view.js";
import { mountMcpView } from "./mcp-view.js";
import { mountMcpApprovalView } from "./mcp-approval-view.js";
import { mountSchedulerView } from "./scheduler-view.js";
import { mountConversationView } from "./conversation-view.js";
import { createConversationViewModel } from "./conversation-view-model.js";
import type {
  ConversationChangedPayload,
  ConversationDetail,
} from "../../shared/conversation-types.js";
import "./style.css";

declare global {
  interface Window {
    cyrene: CyreneApi;
  }
}

const form = document.querySelector<HTMLFormElement>("#chat-form");
const input = document.querySelector<HTMLInputElement>("#message-input");
const messages = document.querySelector<HTMLElement>("#messages");
const events = document.querySelector<HTMLOListElement>("#events");
const status = document.querySelector<HTMLElement>("#status");
const newChatButton = document.querySelector<HTMLButtonElement>("#new-chat-button");
const styleSelectElement = document.querySelector<HTMLSelectElement>("#style-select");
const chatViewElement = document.querySelector<HTMLElement>("#chat-view");
const memoryViewElement = document.querySelector<HTMLElement>("#memory-view");
const chatViewButtonElement = document.querySelector<HTMLButtonElement>("#chat-view-button");
const memoryViewButtonElement = document.querySelector<HTMLButtonElement>("#memory-view-button");
const skillsViewElement = document.querySelector<HTMLElement>("#skills-view");
const skillsViewButtonElement = document.querySelector<HTMLButtonElement>("#skills-view-button");
const mcpViewElement = document.querySelector<HTMLElement>("#mcp-view");
const mcpViewButtonElement = document.querySelector<HTMLButtonElement>("#mcp-view-button");
const schedulerViewElement = document.querySelector<HTMLElement>("#scheduler-view");
const schedulerViewButtonElement = document.querySelector<HTMLButtonElement>("#scheduler-view-button");
const mcpApprovalRootElement = document.querySelector<HTMLElement>("#mcp-approval-root");
const conversationSidebarElement = document.querySelector<HTMLElement>("#conversation-sidebar");

function requireElement<T extends Element>(element: T | null, name: string): T {
  if (!element) {
    throw new Error(`Missing required element: ${name}`);
  }
  return element;
}

const chatForm = requireElement(form, "chat-form");
const messageInput = requireElement(input, "message-input");
const messageList = requireElement(messages, "messages");
const eventList = requireElement(events, "events");
const statusBadge = requireElement(status, "status");
const newChat = requireElement(newChatButton, "new-chat-button");
const styleSelect = requireElement(styleSelectElement, "style-select");
const chatView = requireElement(chatViewElement, "chat-view");
const memoryView = requireElement(memoryViewElement, "memory-view");
const chatViewButton = requireElement(chatViewButtonElement, "chat-view-button");
const memoryViewButton = requireElement(memoryViewButtonElement, "memory-view-button");
const skillsView = requireElement(skillsViewElement, "skills-view");
const skillsViewButton = requireElement(skillsViewButtonElement, "skills-view-button");
const mcpView = requireElement(mcpViewElement, "mcp-view");
const mcpViewButton = requireElement(mcpViewButtonElement, "mcp-view-button");
const schedulerView = requireElement(schedulerViewElement, "scheduler-view");
const schedulerViewButton = requireElement(schedulerViewButtonElement, "scheduler-view-button");
const mcpApprovalRoot = requireElement(mcpApprovalRootElement, "mcp-approval-root");
const conversationSidebar = requireElement(conversationSidebarElement, "conversation-sidebar");
let isChatBusy = false;
let selectedStyle: StyleId = "default";
let activeConversationId = "";
let conversationModel: ReturnType<typeof createConversationViewModel> | undefined;

const memoryPanel = mountMemoryView({
  root: memoryView,
  api: window.cyrene.memory,
});
const skillsPanel = mountSkillsView({
  root: skillsView,
  api: window.cyrene.skills,
});
const mcpPanel = mountMcpView({ root: mcpView, api: window.cyrene.mcp });
const schedulerPanel = mountSchedulerView({ root: schedulerView, api: window.cyrene.scheduler });
mountMcpApprovalView({ root: mcpApprovalRoot, api: window.cyrene.mcp });

const conversationPanel = mountConversationView({
  root: conversationSidebar,
  onCreate: () => createConversation(),
  onSelect: (id) => openConversation(id),
  onRename: (id) => renameConversation(id),
  onRemove: (id) => removeConversation(id),
});

function setActiveView(view: "chat" | "memory" | "skills" | "mcp" | "scheduler"): void {
  const isMemory = view === "memory";
  const isSkills = view === "skills";
  const isMcp = view === "mcp";
  const isScheduler = view === "scheduler";
  chatView.hidden = isMemory || isSkills || isMcp || isScheduler;
  memoryView.hidden = !isMemory;
  skillsView.hidden = !isSkills;
  mcpView.hidden = !isMcp;
  schedulerView.hidden = !isScheduler;
  chatViewButton.classList.toggle("is-active", !isMemory && !isSkills && !isMcp && !isScheduler);
  memoryViewButton.classList.toggle("is-active", isMemory);
  skillsViewButton.classList.toggle("is-active", isSkills);
  mcpViewButton.classList.toggle("is-active", isMcp);
  schedulerViewButton.classList.toggle("is-active", isScheduler);
  chatViewButton.setAttribute("aria-pressed", String(!isMemory && !isSkills && !isMcp && !isScheduler));
  memoryViewButton.setAttribute("aria-pressed", String(isMemory));
  skillsViewButton.setAttribute("aria-pressed", String(isSkills));
  mcpViewButton.setAttribute("aria-pressed", String(isMcp));
  schedulerViewButton.setAttribute("aria-pressed", String(isScheduler));
}

function appendMessage(role: "user" | "agent", text: string): void {
  const item = document.createElement("article");
  item.className = `message message-${role}`;
  item.textContent = text;
  messageList.append(item);
  messageList.scrollTop = messageList.scrollHeight;
}

function appendEvent(text: string): void {
  const item = document.createElement("li");
  item.textContent = text;
  eventList.append(item);
  eventList.scrollTop = eventList.scrollHeight;
}

function renderConversation(detail: ConversationDetail): void {
  messageList.replaceChildren();
  for (const message of detail.messages) {
    if (message.status === "failed") continue;
    appendMessage(message.role === "user" ? "user" : "agent", message.content);
  }
}

function setBusy(isBusy: boolean): void {
  isChatBusy = isBusy;
  messageInput.disabled = isBusy;
  newChat.disabled = isBusy;
  styleSelect.disabled = isBusy;
  if (isBusy) {
    statusBadge.textContent = "Running";
  }
}

function populateStyleOptions(): void {
  for (const option of STYLE_OPTIONS) {
    const element = document.createElement("option");
    element.value = option.id;
    element.textContent = option.label;
    styleSelect.append(element);
  }
}

async function loadConversationStyle(): Promise<void> {
  selectedStyle = await loadSelectedStyle(window.cyrene.persona, activeConversationId);
  styleSelect.value = selectedStyle;
}

function renderConversationList(snapshot: ConversationChangedPayload): void {
  conversationPanel.render({
    ...snapshot,
    unreadConversationIds: conversationModel?.snapshot().unreadConversationIds ?? [],
  });
}

async function openConversation(id: string, persistActive = true): Promise<void> {
  const detail = persistActive
    ? await window.cyrene.conversations.setActive(id)
    : await window.cyrene.conversations.get(id);
  activeConversationId = id;
  conversationModel?.setActive(id);
  renderConversation(detail);
  await loadConversationStyle();
  renderConversationList(await window.cyrene.conversations.list());
}

async function createConversation(): Promise<void> {
  const result = await window.cyrene.conversations.create();
  if (!conversationModel) conversationModel = createConversationViewModel(result.conversation.id);
  await openConversation(result.conversation.id, false);
  messageInput.focus();
}

async function renameConversation(id: string): Promise<void> {
  const current = (await window.cyrene.conversations.get(id)).title;
  const title = window.prompt("Conversation title", current)?.trim();
  if (!title) return;
  await window.cyrene.conversations.rename(id, title);
  renderConversationList(await window.cyrene.conversations.list());
}

async function removeConversation(id: string): Promise<void> {
  if (!window.confirm("Delete this conversation?")) return;
  const result = await window.cyrene.conversations.remove(id);
  if (!conversationModel) conversationModel = createConversationViewModel(result.activeConversationId);
  await openConversation(result.activeConversationId, false);
}

async function initializeConversations(): Promise<void> {
  populateStyleOptions();
  const snapshot = await window.cyrene.conversations.list();
  activeConversationId = snapshot.activeConversationId;
  conversationModel = createConversationViewModel(activeConversationId);
  renderConversationList(snapshot);
  await openConversation(activeConversationId, false);
}

window.cyrene.chat.onAgentEvent((payload) => {
  if (payload.conversationId && payload.conversationId !== activeConversationId) return;
  appendEvent(formatRendererEventPayload(payload));
});

window.cyrene.conversations.onChanged((payload) => {
  renderConversationList(payload);
});

chatViewButton.addEventListener("click", () => {
  setActiveView("chat");
  messageInput.focus();
});

memoryViewButton.addEventListener("click", async () => {
  setActiveView("memory");
  await memoryPanel.show();
});

skillsViewButton.addEventListener("click", async () => {
  setActiveView("skills");
  await skillsPanel.show();
});

mcpViewButton.addEventListener("click", async () => {
  setActiveView("mcp");
  await mcpPanel.show();
});

schedulerViewButton.addEventListener("click", async () => {
  setActiveView("scheduler");
  await schedulerPanel.show();
});

styleSelect.addEventListener("change", async () => {
  const requestedStyle = styleSelect.value;
  if (!isStyleId(requestedStyle)) {
    styleSelect.value = selectedStyle;
    return;
  }

  styleSelect.disabled = true;
  try {
    selectedStyle = await changeSelectedStyle(
      window.cyrene.persona,
      activeConversationId,
      requestedStyle,
    );
    styleSelect.value = selectedStyle;
  } catch (error) {
    styleSelect.value = selectedStyle;
    const message = formatRendererErrorMessage(error);
    appendEvent(message);
    statusBadge.textContent = "Error";
  } finally {
    styleSelect.disabled = isChatBusy;
  }
});

newChat.addEventListener("click", async () => {
  setBusy(true);
  try {
    await createConversation();
    statusBadge.textContent = "Ready";
  } catch (error) {
    const message = formatRendererErrorMessage(error);
    appendMessage("agent", message);
    appendEvent(message);
    statusBadge.textContent = "Error";
  } finally {
    setBusy(false);
    messageInput.focus();
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  appendMessage("user", text);
  messageInput.value = "";
  setBusy(true);
  const conversationId = activeConversationId;
  const requestId = `request_${crypto.randomUUID()}`;
  conversationModel?.beginRun(conversationId, requestId);

  try {
    const result = await window.cyrene.chat.sendMessage({
      conversationId,
      requestId,
      text,
    });
    const route = conversationModel?.finishRun(result);
    if (route?.renderInActiveConversation) appendMessage("agent", result.reply);
    renderConversationList(await window.cyrene.conversations.list());
    statusBadge.textContent = "Ready";
  } catch (error) {
    conversationModel?.finishRun({ conversationId, requestId });
    const message = formatRendererErrorMessage(error);
    if (activeConversationId === conversationId) appendMessage("agent", message);
    appendEvent(message);
    statusBadge.textContent = "Error";
  } finally {
    setBusy(false);
    messageInput.focus();
  }
});

initializeConversations().catch((error) => {
  const message = formatRendererErrorMessage(error);
  appendEvent(message);
  statusBadge.textContent = "Error";
});
