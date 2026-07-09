# Phase 3 Agent Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured Agent event stream and trace collector so CLI logs, future Electron UI, and tests can observe the same runtime lifecycle.

**Architecture:** Runtime events live in `src/main/agent/agent-events.ts`, while `tool-agent.ts` only emits typed events through `onEvent`. The terminal CLI formats events with the shared formatter instead of owning event-specific string logic.

**Tech Stack:** TypeScript, Vitest, Node.js fetch-compatible runtime.

## Global Constraints

- Keep this phase small and testable.
- Do not add Electron, persistence, RAG, memory, or hook mutation behavior in this phase.
- Keep event payloads structured and serializable.
- Use TDD for new behavior.

---

### Task 1: Event Types, Formatter, and Trace Collector

**Files:**
- Create: `src/main/agent/agent-events.ts`
- Test: `tests/agent/agent-events.test.ts`

**Interfaces:**
- Produces: `AgentEvent`, `formatAgentEventForTerminal(event: AgentEvent): string`, `createAgentTraceCollector(): AgentTraceCollector`
- Consumes: no project internals except plain TypeScript types.

- [ ] **Step 1: Write the failing test**

Test terminal formatting for run/model/tool/final events and trace collection.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/agent/agent-events.test.ts`

- [ ] **Step 3: Implement the module**

Add a serializable event union and a small collector with an `onEvent` callback.

- [ ] **Step 4: Run the focused test**

Run: `npm.cmd test -- tests/agent/agent-events.test.ts`

### Task 2: Emit Events From Tool Agent

**Files:**
- Modify: `src/main/agent/tool-agent.ts`
- Test: `tests/agent/tool-agent.test.ts`

**Interfaces:**
- Consumes: `AgentEvent` from Task 1.
- Produces: `runToolAgent(... onEvent)` emits run, model, tool, final, finish, and error events.

- [ ] **Step 1: Write failing event sequence tests**

Assert a tool run emits lifecycle events in order and an HTTP failure emits `run_error`.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npm.cmd test -- tests/agent/tool-agent.test.ts`

- [ ] **Step 3: Update `runToolAgent` event emission**

Emit structured events around the existing loop without changing tool behavior.

- [ ] **Step 4: Run focused tests**

Run: `npm.cmd test -- tests/agent/tool-agent.test.ts`

### Task 3: CLI Uses Shared Event Formatter

**Files:**
- Modify: `src/cli/chat.ts`
- Modify: `tests/cli/chat.test.ts`

**Interfaces:**
- Consumes: `formatAgentEventForTerminal` from Task 1.
- Produces: CLI terminal logs based on shared event formatting.

- [ ] **Step 1: Write failing CLI test update**

Remove CLI-owned tool formatter expectations and test that runtime registry/config still work.

- [ ] **Step 2: Run focused test**

Run: `npm.cmd test -- tests/cli/chat.test.ts`

- [ ] **Step 3: Replace CLI formatter with shared formatter**

Import and call `formatAgentEventForTerminal`.

- [ ] **Step 4: Run focused test**

Run: `npm.cmd test -- tests/cli/chat.test.ts`

### Task 4: Chinese Learning Document and Verification

**Files:**
- Create: `docs/learning/phase-03-agent-events.zh-CN.md`

**Interfaces:**
- Produces: beginner-friendly Chinese explanation of event streams and trace collection.

- [ ] **Step 1: Add the learning document**

Explain why `console.log` is insufficient, what each event means, and how to read one Agent run.

- [ ] **Step 2: Run full verification**

Run: `npm.cmd test`, `npm.cmd run typecheck`, and a `/exit` CLI smoke test.
