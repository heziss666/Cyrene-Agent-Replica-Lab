# Phase 4 Electron Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal Electron desktop shell that calls the existing tool agent from main and displays structured agent events in renderer.

**Architecture:** Shared IPC channel constants live in `src/shared`. Electron main owns app/window lifecycle and registers chat IPC handlers. Preload exposes a narrow `window.cyrene.chat` bridge. Renderer is a small Vite-powered chat page that uses the bridge and never receives direct Node.js access.

**Tech Stack:** TypeScript, Electron, Vite, Vitest, Node.js 22.

## Global Constraints

- Keep Phase 4 focused on Electron shell and IPC wiring only.
- Do not implement RAG, memory, hooks, settings pages, packaging, or Live2D.
- Renderer must not access API keys or Node.js APIs directly.
- Reuse the existing `runToolAgent`, `AgentEvent`, and tool registry.
- Use TDD for testable shared/main/renderer logic.

---

### Task 1: IPC Contract

**Files:**
- Create: `src/shared/ipc-channels.ts`
- Test: `tests/shared/ipc-channels.test.ts`

**Interfaces:**
- Produces: `IPC_CHANNELS.chat.sendMessage` and `IPC_CHANNELS.chat.agentEvent`
- Consumes: no project internals.

- [ ] **Step 1: Write failing tests**

Assert channel names are stable string constants.

- [ ] **Step 2: Verify red**

Run: `npm.cmd test -- tests/shared/ipc-channels.test.ts`

- [ ] **Step 3: Implement constants**

Create `src/shared/ipc-channels.ts`.

- [ ] **Step 4: Verify green**

Run: `npm.cmd test -- tests/shared/ipc-channels.test.ts`

### Task 2: Main Chat IPC Handler

**Files:**
- Create: `src/main/app/register-chat-ipc.ts`
- Test: `tests/main/register-chat-ipc.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`, `runToolAgent`-compatible function, `ToolRegistry`, vendor adapter.
- Produces: `registerChatIpc(deps): void`

- [ ] **Step 1: Write failing tests**

Use fake `ipcMain`, fake sender, and fake `runAgent` to assert invoke handling and event forwarding.

- [ ] **Step 2: Verify red**

Run: `npm.cmd test -- tests/main/register-chat-ipc.test.ts`

- [ ] **Step 3: Implement handler**

Add dependency-injected handler registration so tests do not need Electron.

- [ ] **Step 4: Verify green**

Run: `npm.cmd test -- tests/main/register-chat-ipc.test.ts`

### Task 3: Electron Main and Preload Skeleton

**Files:**
- Create: `src/main/app/create-window.ts`
- Create: `src/main/app/main.ts`
- Create: `src/preload/index.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`

**Interfaces:**
- Consumes: `registerChatIpc`
- Produces: Electron app entry and preload bridge.

- [ ] **Step 1: Add Electron/Vite dependencies and scripts**

Scripts should support renderer dev server, main/preload compilation, and Electron startup.

- [ ] **Step 2: Add window creation**

Create a secure BrowserWindow with context isolation and preload.

- [ ] **Step 3: Add preload bridge**

Expose `window.cyrene.chat.sendMessage` and `window.cyrene.chat.onAgentEvent`.

- [ ] **Step 4: Run typecheck**

Run: `npm.cmd run typecheck`

### Task 4: Renderer Chat Page

**Files:**
- Create: `src/renderer/chat/index.html`
- Create: `src/renderer/chat/main.ts`
- Create: `src/renderer/chat/style.css`
- Create: `src/renderer/chat/renderer-events.ts`
- Test: `tests/renderer/renderer-events.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`
- Produces: small UI and `formatRendererEvent(event: AgentEvent): string`

- [ ] **Step 1: Write failing renderer formatter test**

Assert agent events become readable UI log strings.

- [ ] **Step 2: Verify red**

Run: `npm.cmd test -- tests/renderer/renderer-events.test.ts`

- [ ] **Step 3: Implement renderer formatter and page**

Add minimal DOM code and styling.

- [ ] **Step 4: Verify green**

Run: `npm.cmd test -- tests/renderer/renderer-events.test.ts`

### Task 5: Learning Document and Full Verification

**Files:**
- Create: `docs/learning/phase-04-electron-shell.zh-CN.md`

**Interfaces:**
- Produces: Chinese explanation of Electron main/preload/renderer and IPC flow.

- [ ] **Step 1: Add learning document**

Explain the three layers with Python-friendly analogies.

- [ ] **Step 2: Run full checks**

Run: `npm.cmd test`, `npm.cmd run typecheck`, and Electron build scripts.
