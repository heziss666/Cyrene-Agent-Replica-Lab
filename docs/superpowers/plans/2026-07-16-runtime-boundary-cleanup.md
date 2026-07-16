# Runtime Boundary Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move shared Agent runtime factories out of the CLI layer and remove the obsolete minimal Agent implementation without changing behavior.

**Architecture:** `src/main/runtime/agent-runtime.ts` becomes the shared dependency factory used by both terminal and Electron entry points. `src/cli/chat.ts` retains only terminal interaction, while Electron files import runtime helpers directly from `main/runtime`. The obsolete one-shot Agent and its test are removed.

**Tech Stack:** TypeScript, Node.js, Electron, Vitest

## Global Constraints

- Preserve terminal and Electron behavior.
- Do not add dependencies or expand the refactor into a ChatService rewrite.
- Execute directly on `main` as approved by the user.

---

### Task 1: Establish The Runtime Module

**Files:**
- Create: `src/main/runtime/agent-runtime.ts`
- Create: `tests/runtime/agent-runtime.test.ts`
- Modify: `tests/cli/chat.test.ts`

**Interfaces:**
- Produces: `createRuntimePromptComposer()`, `buildModelMessages(systemPrompt, history)`, `loadRuntimeModelConfig()`, `createRuntimeToolRegistry()`.

- [x] **Step 1: Move the four helper tests to `tests/runtime/agent-runtime.test.ts` and import the not-yet-created runtime module.**
- [x] **Step 2: Run `npx.cmd vitest run tests/runtime/agent-runtime.test.ts` and verify it fails because the module is missing.**
- [x] **Step 3: Create `agent-runtime.ts` with the existing helper implementations and required imports.**
- [x] **Step 4: Run the runtime and CLI tests and verify they pass.**

### Task 2: Redirect Entry Points

**Files:**
- Modify: `src/cli/chat.ts`
- Modify: `src/main/app/register-chat-ipc.ts`
- Modify: `src/main/app/main.ts`

**Interfaces:**
- Consumes: the four functions exported by `src/main/runtime/agent-runtime.ts`.

- [x] **Step 1: Make `chat.ts` import the runtime helpers and retain only terminal orchestration.**
- [x] **Step 2: Change Electron imports from `../../cli/chat.js` to `../runtime/agent-runtime.js`.**
- [x] **Step 3: Run CLI, chat IPC, typecheck, and build verification.**

### Task 3: Remove The Obsolete Agent

**Files:**
- Delete: `src/main/agent/minimal-agent.ts`
- Delete: `tests/agent/minimal-agent.test.ts`
- Modify: `docs/learning/phase-01-minimal-agent.zh-CN.md`

**Interfaces:**
- Current Agent entry remains `runToolAgent()` from `src/main/agent/tool-agent.ts`.

- [x] **Step 1: Delete the unused implementation and its dedicated test.**
- [x] **Step 2: Add a current-state note to the Phase 1 learning document.**
- [x] **Step 3: Verify no production or test code references `minimal-agent`.**
- [x] **Step 4: Run `npm.cmd test`, `npm.cmd run typecheck`, and `npm.cmd run build`.**
- [x] **Step 5: Review the diff and commit the implementation.**
