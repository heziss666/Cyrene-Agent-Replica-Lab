# Phase 12 Reliable Streaming Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not dispatch subagents; the user explicitly prefers inline execution.

**Goal:** Add a shared persistent Agent run runtime with controlled concurrency, safe cancellation, bounded retries/timeouts, OpenAI-compatible streaming, partial-message checkpoints, sanitized traces, usage metrics, Scheduler integration, and an Electron Runs page.

**Architecture:** Chat and Scheduler submit work to one AgentRunManager. The Manager owns queue admission, AbortController state, sequence-numbered events, persistent traces, usage aggregation, and terminal status. runToolAgent remains the domain Agent loop but gains streaming and cancellation inputs.

**Tech Stack:** TypeScript 5.7, Node.js 22, Electron 43, Vite 5, Vitest 2, Zod 4, OpenAI-compatible SSE, JSON atomic persistence.

## Global Constraints

- Work directly on local main; do not create a branch/worktree and do not push automatically.
- Execute inline without Subagents.
- Use TDD for every production behavior.
- Preserve Chat, Memory, RAG, Skills, MCP, Scheduler, and non-streaming CLI behavior.
- Default global active runs: 2. One active Chat run per conversationId.
- Keep at most 1000 Run records and remove records older than 30 days.
- Never auto-retry tools. Retry model requests only before any valid Delta.
- Persist only sanitized bounded Trace data.
- Real DeepSeek/MCP checks are explicit and never part of npm test.
- Design authority: docs/superpowers/specs/2026-07-18-phase-12-reliable-streaming-runs-design.zh-CN.md.

---

### Task 0: Commit the Verified Scheduler Reliability Baseline

**Files:** Commit the currently modified Agent, Scheduler, Tool, Vendor, and focused test files.

**Produces:** Required first-round tool choice, scheduled timezone output, transient model retry, and specific Scheduler HTTP errors as the clean baseline.

- [ ] Run focused regression tests:

~~~powershell
npm.cmd test -- tests/vendors/openai-compatible.test.ts tests/vendors/chat-completion-client.test.ts tests/agent/tool-agent.test.ts tests/scheduler/scheduled-agent-runner.test.ts tests/tools/built-in-tools.test.ts
~~~

Expected: all focused tests pass.

- [ ] Run npm.cmd run typecheck, npm.cmd test, npm.cmd run build, and git diff --check.
- [ ] Stage only the existing 12 modified source/test files and commit:

~~~powershell
git commit -m "fix: stabilize scheduled tool runs"
~~~

Expected: design commit remains separate and the worktree becomes clean.

---

### Task 1: Define Run Contracts, Errors, and Sanitization

**Files:**
- Create: src/main/runs/agent-run-types.ts
- Create: src/main/runs/agent-run-error.ts
- Create: src/main/runs/trace-sanitizer.ts
- Test: tests/runs/agent-run-error.test.ts
- Test: tests/runs/trace-sanitizer.test.ts

**Produces:** AgentRunStatus, AgentRunIdentity, AgentRunRecord, AgentRunSummary, AgentRunTraceEvent, AgentRunUsage, AgentRunEventEnvelope, AgentRunError, normalizeAgentRunError(), and sanitizeTraceValue().

- [ ] Write failing error tests:

~~~ts
expect(normalizeAgentRunError(
  new Error("Model request failed: HTTP 429 - busy"),
)).toMatchObject({
  code: "MODEL_HTTP_429",
  category: "provider",
  retryable: true,
  httpStatus: 429,
});
expect(normalizeAgentRunError(
  new DOMException("aborted", "AbortError"),
)).toMatchObject({
  code: "RUN_CANCELLED",
  category: "cancelled",
  retryable: false,
});
~~~

- [ ] Write failing redaction tests for apiKey, authorization, password, Bearer strings, depth 5, arrays 50, and bounded previews.
- [ ] Run npm.cmd test -- tests/runs/agent-run-error.test.ts tests/runs/trace-sanitizer.test.ts and observe missing-module failures.
- [ ] Implement immutable versioned contracts and safe error mapping.
- [ ] Rerun focused tests and typecheck.
- [ ] Commit: feat: define safe agent run contracts.

---

### Task 2: Persist Run Records and Enforce Retention

**Files:**
- Create: src/main/runs/run-retention.ts
- Create: src/main/runs/agent-run-store.ts
- Test: tests/runs/run-retention.test.ts
- Test: tests/runs/agent-run-store.test.ts

**Produces:** applyRunRetention(records, options) and createAgentRunStore({ rootDir, now }) with initialize/list/load/save/remove/clear/flush.

- [ ] Write failing retention tests using 1002 records spanning 31 days; assert expired records are removed first and exactly 1000 newest survivors remain.
- [ ] Write failing Store tests for atomic save/reload, serialized updates, index rebuild, corrupt quarantine, and unknown-schema rejection without overwrite.
- [ ] Run the two test files and observe RED.
- [ ] Implement runs/index.json, runs/records/run_*.json, and runs/corrupt using existing writeFileAtomically().
- [ ] Run focused tests and typecheck.
- [ ] Commit: feat: persist sanitized agent run traces.

---

### Task 3: Implement Fair Controlled Concurrency

**Files:**
- Create: src/main/runs/agent-run-queue.ts
- Test: tests/runs/agent-run-queue.test.ts

**Produces:** createAgentRunQueue({ maxConcurrent }) with enqueue/cancel/complete/beginShutdown/pendingCount/activeCount.

- [ ] Write failing tests proving: maximum two active; same conversation serializes; a blocked queue head does not block another conversation; Scheduler consumes a global slot; queued cancellation never calls run; shutdown rejects submissions.

~~~ts
expect(maxObservedActive).toBe(2);
expect(maxObservedByConversation.get("conv-a")).toBe(1);
expect(startOrder).toEqual(["a1", "b1", "c1", "a2"]);
~~~

- [ ] Run npm.cmd test -- tests/runs/agent-run-queue.test.ts and observe RED.
- [ ] Implement atomic slot/conversation admission with FIFO scanning.
- [ ] Rerun test and typecheck.
- [ ] Commit: feat: queue controlled agent run concurrency.

---

### Task 4: Manage Run Lifecycle, Usage, and Cancellation

**Files:**
- Create: src/main/runs/usage-collector.ts
- Create: src/main/runs/agent-run-controller.ts
- Create: src/main/runs/agent-run-manager.ts
- Create: src/main/config/run-config.ts
- Test: tests/runs/usage-collector.test.ts
- Test: tests/runs/agent-run-controller.test.ts
- Test: tests/runs/agent-run-manager.test.ts

**Produces:** submit(), cancel(), list(), get(), remove(), clear(), beginShutdown(), flush(). execute(context) receives runId, signal, emit, and recordUsage.

- [ ] Write failing tests for strictly increasing sequences, single terminal transition, provider usage preferred over estimate, all rounds summed, queued cancellation, active AbortSignal cancellation, and sanitized persistence.
- [ ] Run focused tests and observe RED.
- [ ] Implement Controller around one AbortController and Manager around Queue/Store.
- [ ] Persist queued before admission and terminal state before final notification.
- [ ] Ensure listener exceptions cannot poison a Run.
- [ ] Run npm.cmd test -- tests/runs and typecheck.
- [ ] Commit: feat: manage cancellable agent run lifecycles.

---

### Task 5: Parse OpenAI-Compatible SSE and Tool Deltas

**Files:**
- Create: src/main/vendors/sse-parser.ts
- Create: src/main/vendors/openai-compatible-stream.ts
- Modify: src/main/vendors/types.ts
- Modify: src/main/vendors/openai-compatible.ts
- Modify: src/main/vendors/chat-completion-client.ts
- Test: tests/vendors/sse-parser.test.ts
- Test: tests/vendors/openai-compatible-stream.test.ts
- Test: tests/vendors/chat-completion-client.test.ts

**Produces:** An async stream yielding text deltas plus one assembled terminal completion with Tool Calls and Usage. Existing non-streaming completion remains supported.

- [ ] Write failing SSE tests with arbitrary byte boundaries, CRLF, multiple frames, comments, malformed JSON, and [DONE].
- [ ] Write failing Tool Call tests splitting ID/name/arguments across multiple deltas.
- [ ] Write failing retry tests: retry 503 before valid Delta; no retry after text/tool Delta; abort maps to cancellation; max three attempts.
- [ ] Run Vendor tests and observe RED.
- [ ] Implement incremental framing and OpenAI-compatible assembly.
- [ ] Run all Vendor tests and typecheck.
- [ ] Commit: feat: stream openai-compatible model responses.

---

### Task 6: Stream and Safely Cancel ToolAgent

**Files:**
- Modify: src/main/agent/tool-agent.ts
- Modify: src/main/tools/tool-types.ts
- Modify only as required: src/main/mcp execution adapters
- Test: tests/agent/tool-agent.test.ts
- Test: affected tests/mcp/*.test.ts

**Consumes:** signal, onTextDelta, modelRequestTimeoutMs, toolTimeoutMs, runTimeoutMs.
**Produces:** ToolExecutionContext.signal.

- [ ] Write failing tests: ordered text deltas; cancel before Tool prevents execution; cancel during Tool prevents next model call; Tool timeout never auto-retries; five-round limit remains.
- [ ] Run Agent tests and observe RED.
- [ ] Add cancellation checkpoints before model, before each Tool, after Tool, and before the next round.
- [ ] Do not claim an unsupported Tool was killed; record uncertain completion and suppress subsequent work.
- [ ] Run tests/agent, tests/tools, tests/mcp, and typecheck.
- [ ] Commit: feat: stream and cancel tool agent runs.

---

### Task 7: Persist Streaming and Cancelled Conversation Messages

**Files:**
- Modify: src/shared/conversation-types.ts
- Modify: src/main/conversations/conversation-types.ts
- Modify: src/main/conversations/conversation-migrations.ts
- Modify: src/main/conversations/conversation-service.ts
- Modify: src/main/context/context-manager.ts
- Modify: src/main/context/conversation-summarizer.ts
- Modify: src/main/context/conversation-history-retriever.ts
- Test: tests/conversations/conversation-migrations.test.ts
- Test: tests/conversations/conversation-service.test.ts
- Test: affected tests/context/*.test.ts

**Produces:** statuses streaming/cancelled and Service operations startAssistantStream/checkpointAssistantStream/completeRun/cancelRun/failRun/recoverInterruptedRuns.

- [ ] Write failing migration tests: old records load; stale pending/streaming become failed at startup; partial text is preserved.
- [ ] Write failing checkpoint tests: one stable Assistant message ID; at most one periodic save per second; terminal operation forces final save; another Run cannot mutate the request.
- [ ] Write failing context tests proving streaming/cancelled/failed messages never enter context, summaries, or history chunks.
- [ ] Implement throttled atomic checkpoints and terminal transitions.
- [ ] Run conversations/context tests and typecheck.
- [ ] Commit: feat: checkpoint partial conversation replies.

---

### Task 8: Expose Run and Streaming IPC Safely

**Files:**
- Create: src/shared/run-api-types.ts
- Modify: src/shared/ipc-channels.ts
- Create: src/main/app/register-runs-ipc.ts
- Modify: src/main/app/register-chat-ipc.ts
- Modify: src/preload/index.ts
- Modify: Renderer Electron API declaration
- Test: tests/main/register-runs-ipc.test.ts
- Test: tests/main/register-chat-ipc.test.ts
- Test: Preload allowlist tests

**Produces:** Chat send resolves immediately to runId/status. Runs API exposes list/get/cancel/remove/clear/export/onChanged/onEvent.

- [ ] Write failing tests for exact payload validation, immediate acceptance, sequence envelopes, cancel, destroyed senders, and export without caller-supplied file paths.
- [ ] Run focused tests and observe RED.
- [ ] Implement Main handlers and contextBridge allowlist; Renderer never receives ipcRenderer.
- [ ] Rerun Main/Preload tests and typecheck.
- [ ] Commit: feat: expose streaming agent runs through ipc.

---

### Task 9: Build Streaming Chat and Stop Controls

**Files:**
- Modify: src/renderer/chat/index.ts
- Modify: src/renderer/chat/conversation-view-model.ts
- Modify: src/renderer/chat/conversation-view.ts
- Modify: src/renderer/chat/styles.css
- Test: tests/renderer/conversation-view-model.test.ts
- Test: tests/renderer/conversation-view.test.ts
- Modify: scripts/electron-smoke.mjs

**Produces:** Map<runId, LiveRunViewState> and sequence-aware routing.

- [ ] Write failing tests for queued/running states, Delta concatenation, duplicate-sequence rejection, cross-session isolation, Stop availability, cancelled partial display, and terminal cleanup.
- [ ] Implement view-model first and rerun its tests.
- [ ] Add a square icon Stop button with tooltip; keep toolbar fixed and avoid nested cards.
- [ ] Run Renderer tests and npm.cmd run test:electron-smoke.
- [ ] Commit: feat: stream and stop conversation replies.

---

### Task 10: Share the Runtime with Scheduler

**Files:**
- Modify: src/main/scheduler/scheduled-agent-runner.ts
- Modify: src/main/scheduler/task-scheduler.ts
- Modify: src/main/scheduler/scheduled-task-types.ts
- Modify: src/main/app/register-scheduler-ipc.ts
- Modify: src/shared/scheduler-api-types.ts
- Modify: src/renderer/chat/scheduler-view-model.ts
- Modify: src/renderer/chat/scheduler-view.ts
- Test: affected Scheduler/Main/Renderer tests

**Produces:** Scheduler records agentRunId, uses shared slots/retries/timeouts/errors/Usage, and can cancel queued/running runs without streaming text UI.

- [ ] Write failing tests that Chat and Scheduler share two slots, cancellation reaches Manager, structured error/Usage persists, and model retry does not rerun a completed Tool.
- [ ] Run Scheduler-focused tests and observe RED.
- [ ] Integrate Scheduler through Manager while preserving existing Scheduler history.
- [ ] Run tests/scheduler, Scheduler IPC/Renderer tests, and npm.cmd run test:scheduler.
- [ ] Commit: feat: share reliable runtime with scheduler.

---

### Task 11: Add the Runs Diagnostics Page

**Files:**
- Create: src/renderer/chat/runs-view-model.ts
- Create: src/renderer/chat/runs-view.ts
- Modify: src/renderer/chat/index.html
- Modify: src/renderer/chat/index.ts
- Modify: src/renderer/chat/styles.css
- Test: tests/renderer/runs-view-model.test.ts
- Test: tests/renderer/runs-view.test.ts
- Modify: scripts/electron-smoke.mjs

- [ ] Write failing tests for status/source/time filters, chronological Trace, usage provenance, safe errors, cancel/delete/clear/export, live updates, and empty/corrupt states.
- [ ] Implement the view-model and view using only window.cyrene.runs.
- [ ] Extend smoke tests for desktop/narrow viewport, fixed toolbar, no overflow, long error wrapping, and responsive list/detail layout.
- [ ] Run focused Renderer tests and Electron smoke.
- [ ] Commit: feat: add agent run diagnostics page.

---

### Task 12: Initialize, Shut Down, and Smoke Test the Runtime

**Files:**
- Modify: src/main/app/main.ts
- Modify or narrowly generalize: src/main/app/background-memory-shutdown.ts
- Create: scripts/streaming-smoke.ts
- Modify: package.json
- Test: tests/main/background-memory-shutdown.test.ts
- Test: tests/integration/reliable-streaming-run.test.ts

- [ ] Write failing shutdown tests: stop acceptance; cancel queued; abort active; save final checkpoint; flush Run/Conversation/Scheduler/Memory; reject post-shutdown submissions.
- [ ] Write failing end-to-end fake-stream test covering text, Tool Call, cancellation, two conversations, same-conversation queueing, and persisted Trace.
- [ ] Initialize Store/Manager before window creation and register one shutdown path.
- [ ] Add explicit npm run test:streaming. It must never run under npm test.
- [ ] Run integration/shutdown tests and typecheck.
- [ ] Commit: feat: initialize reliable streaming runtime.

---

### Task 13: Document and Verify Phase 12

**Files:**
- Create: docs/learning/phase-12-reliable-streaming-runs.zh-CN.md
- Modify: docs/learning/00-overall-replica-roadmap.zh-CN.md
- Modify: README.md
- Modify Phase 12 code only if verification finds a defect

- [ ] Write the Chinese guide in the established style: plain-language explanation, professional terms, Python equivalents, exact call chain, and test commands.
- [ ] Correct the outdated roadmap Phase 10/11/Voice numbering and document new environment variables without recreating .env.example.
- [ ] Run automated gates:

~~~powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:electron-smoke
npm.cmd run test:scheduler
git diff --check
~~~

- [ ] Run explicit external acceptance:

~~~powershell
npm.cmd run test:embedding
npm.cmd run test:streaming
npm.cmd run test:mcp
~~~

If an external service is unavailable, record the exact blocker without weakening automated tests.

- [ ] Manually test two concurrent conversations, same-conversation queueing, Stop during text/Tool, partial reply after restart, Scheduler cancellation, Runs filters/detail/export, and narrow layout.
- [ ] Scan tracked content for credentials and inspect every match.
- [ ] Commit: docs: explain reliable streaming agent runs.
- [ ] Do not push automatically.

## Final Acceptance

- [ ] Chat streams through sequence-numbered IPC events.
- [ ] Stop persists a partial cancelled reply and prevents later Agent rounds.
- [ ] Incomplete messages never enter trusted context, summaries, history vectors, or memory judgment.
- [ ] Global concurrency is 2 and each conversation has one active top-level Run.
- [ ] Chat and Scheduler share runtime reliability without Scheduler streaming UI.
- [ ] Retry occurs only before valid Delta and never retries Tools.
- [ ] Trace is sanitized, bounded, persistent, queryable, exportable, and limited to 30 days/1000 records.
- [ ] Usage/timing includes all model rounds and provider/estimated provenance.
- [ ] Runs UI is responsive and exposes safe actions.
- [ ] Shutdown flushes final checkpoints and records.
- [ ] Full automated and explicit real-environment acceptance passes or has a documented external blocker.

