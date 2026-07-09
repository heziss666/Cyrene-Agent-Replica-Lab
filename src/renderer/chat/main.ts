import type { CyreneApi } from "../../shared/electron-api.js";
import {
  formatRendererErrorMessage,
  formatRendererEventPayload,
} from "./renderer-events.js";
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

function clearChatView(): void {
  messageList.replaceChildren();
  eventList.replaceChildren();
}

function setBusy(isBusy: boolean): void {
  messageInput.disabled = isBusy;
  newChat.disabled = isBusy;
  if (isBusy) {
    statusBadge.textContent = "Running";
  }
}

window.cyrene.chat.onAgentEvent((payload) => {
  appendEvent(formatRendererEventPayload(payload));
});

newChat.addEventListener("click", async () => {
  setBusy(true);
  try {
    await window.cyrene.chat.clearSession();
    clearChatView();
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

  try {
    const result = await window.cyrene.chat.sendMessage(text);
    appendMessage("agent", result.reply);
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
