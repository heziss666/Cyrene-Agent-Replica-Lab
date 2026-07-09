# Phase 5 Chat Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Electron chat shell from single-turn requests to an in-memory multi-turn chat session with clear-session support and run-scoped event payloads.

**Architecture:** Add a focused `ChatSession` module in main for message history. Keep the Agent loop unchanged. `register-chat-ipc.ts` owns Electron IPC orchestration, creates a run id for each send, forwards `{ runId, event }` payloads, and writes returned messages back into the session. Renderer remains UI-only and calls the preload bridge.

**Tech Stack:** TypeScript, Electron IPC, Vite renderer, Vitest, Node.js 22.

## Global Constraints

- Keep this phase limited to in-memory session state.
- Do not add persistence, RAG, long-term memory, Stop/Abort, Markdown rendering, or multiple session lists.
- Keep API keys and Agent execution in main.
- Renderer must only call `window.cyrene`.
- Use TDD for new behavior.

---

## File Structure

- Create `src/main/chat/chat-session.ts`: owns one in-memory chat session and message history operations.
- Modify `src/main/app/register-chat-ipc.ts`: use `ChatSession`, create run ids, forward run-scoped events, handle clear-session IPC.
- Modify `src/shared/ipc-channels.ts`: add `chat.clearSession`.
- Modify `src/shared/electron-api.ts`: add result/payload types and `clearSession`.
- Modify `src/preload/index.ts`: expose `clearSession` and pass run-scoped event payloads.
- Modify `src/renderer/chat/index.html`: add a New Chat button.
- Modify `src/renderer/chat/main.ts`: call clear session, reset UI, display run-aware events.
- Modify `src/renderer/chat/renderer-events.ts`: format event payloads with a short run id.
- Modify `src/renderer/chat/style.css`: style the New Chat button and keep layout stable.
- Create `tests/main/chat-session.test.ts`: session behavior tests.
- Modify `tests/main/register-chat-ipc.test.ts`: multi-turn and clear-session tests.
- Modify `tests/shared/ipc-channels.test.ts`: clear channel test.
- Modify `tests/renderer/renderer-events.test.ts`: run-scoped formatter test.
- Create `docs/learning/phase-05-chat-session.zh-CN.md`: Chinese learning document.

---

### Task 1: ChatSession Core

**Files:**
- Create: `src/main/chat/chat-session.ts`
- Test: `tests/main/chat-session.test.ts`

**Interfaces:**
- Produces:
  - `createChatSession(initialMessages: ChatMessage[]): ChatSession`
  - `ChatSession.getMessages(): ChatMessage[]`
  - `ChatSession.appendUserMessage(text: string): ChatMessage[]`
  - `ChatSession.replaceMessages(messages: ChatMessage[]): void`
  - `ChatSession.clear(): void`

- [ ] **Step 1: Write the failing test**

Test that a session starts with system messages, appends user messages, protects internal state from external mutation, replaces messages after Agent result, and clears back to initial messages.

- [ ] **Step 2: Run red**

Run: `npm.cmd test -- tests/main/chat-session.test.ts`

Expected: fail because `src/main/chat/chat-session.ts` does not exist.

- [ ] **Step 3: Implement minimal ChatSession**

Use defensive copies for all message arrays and message objects.

- [ ] **Step 4: Run green**

Run: `npm.cmd test -- tests/main/chat-session.test.ts`

---

### Task 2: Shared IPC and API Types

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/electron-api.ts`
- Test: `tests/shared/ipc-channels.test.ts`

**Interfaces:**
- Produces:
  - `IPC_CHANNELS.chat.clearSession`
  - `ChatSendResult`
  - `ChatClearResult`
  - `ChatAgentEventPayload`
  - `CyreneApi.chat.clearSession`

- [ ] **Step 1: Update failing channel test**

Assert `IPC_CHANNELS.chat.clearSession === "cyrene:chat:clear-session"`.

- [ ] **Step 2: Run red**

Run: `npm.cmd test -- tests/shared/ipc-channels.test.ts`

- [ ] **Step 3: Implement shared channel and API types**

Add the clear-session channel and expose the clear API type.

- [ ] **Step 4: Run green**

Run: `npm.cmd test -- tests/shared/ipc-channels.test.ts`

---

### Task 3: registerChatIpc Uses Session State

**Files:**
- Modify: `src/main/app/register-chat-ipc.ts`
- Modify: `tests/main/register-chat-ipc.test.ts`

**Interfaces:**
- Consumes:
  - `createChatSession`
  - `IPC_CHANNELS.chat.clearSession`
  - existing `runAgent`
- Produces:
  - `sendMessage` returns `{ reply, runId, messageCount, toolResultCount }`
  - event payloads are `{ runId, event }`
  - clear-session resets message history

- [ ] **Step 1: Write failing multi-turn test**

Call the registered send-message handler twice. Assert the second `runAgent` call receives messages from the first result.

- [ ] **Step 2: Write failing run-scoped event test**

Assert events sent to renderer include `{ runId, event }`.

- [ ] **Step 3: Write failing clear-session test**

Call clear-session handler, then send again. Assert history resets to initial messages plus the new user message.

- [ ] **Step 4: Run red**

Run: `npm.cmd test -- tests/main/register-chat-ipc.test.ts`

- [ ] **Step 5: Implement session-backed IPC**

Create one session per registration by default. Generate simple run ids such as `run_1`, `run_2`.

- [ ] **Step 6: Run green**

Run: `npm.cmd test -- tests/main/register-chat-ipc.test.ts`

---

### Task 4: Preload and Renderer Session UI

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/chat/index.html`
- Modify: `src/renderer/chat/main.ts`
- Modify: `src/renderer/chat/renderer-events.ts`
- Modify: `src/renderer/chat/style.css`
- Modify: `tests/renderer/renderer-events.test.ts`

**Interfaces:**
- Consumes:
  - `ChatAgentEventPayload`
  - `CyreneApi.chat.clearSession`
- Produces:
  - renderer can clear session and reset UI
  - renderer event log includes short run id

- [ ] **Step 1: Write failing renderer formatter test**

Test `formatRendererEventPayload({ runId: "run_12", event })` includes `[run_12]`.

- [ ] **Step 2: Run red**

Run: `npm.cmd test -- tests/renderer/renderer-events.test.ts`

- [ ] **Step 3: Implement formatter and preload API**

Add `clearSession` to preload and use the run-scoped formatter in renderer.

- [ ] **Step 4: Add New Chat UI**

Add a button with id `new-chat-button`. On click, call `window.cyrene.chat.clearSession()`, clear message/event DOM, reset status.

- [ ] **Step 5: Run green**

Run: `npm.cmd test -- tests/renderer/renderer-events.test.ts`

---

### Task 5: Learning Document and Verification

**Files:**
- Create: `docs/learning/phase-05-chat-session.zh-CN.md`

**Interfaces:**
- Produces: Chinese explanation of session vs run, message history, Electron main state vs renderer state.

- [ ] **Step 1: Add learning document**

Explain why multi-turn chat requires saving messages, why desktop state belongs in main, and how clear session works.

- [ ] **Step 2: Run full tests**

Run: `npm.cmd test`

- [ ] **Step 3: Run typecheck**

Run: `npm.cmd run typecheck`

- [ ] **Step 4: Run build**

Run: `npm.cmd run build`

- [ ] **Step 5: Manual verification**

Run: `npm.cmd run dev:electron`, send two related messages, then click New Chat and verify the context resets.
