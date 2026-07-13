# Phase 7A Task 9 Report

Status: complete
Commit: `feat: integrate persistent memory with chat`

## Implementation

- Extended `RegisterChatIpcDeps` with injectable memory store, recall, judge, manager, write queue, and context builder seams.
- Assembled one default instance of each Phase 7A memory service during Chat IPC registration and returned `ChatIpcRuntime` adapters for queue flush and pending count.
- Added synchronous-safe IPC event delivery so a destroyed renderer or throwing sender cannot reject the main chat handler or poison background memory work.
- Integrated recall after appending the current user message and capturing the request's style/transition. A total recall or context-build failure emits one factory-created safe recall failure and continues with the persona prompt only.
- Composed exactly one fresh system message from the request-local persona prompt and a non-empty memory context separated by `\n\n---\n\n`; all prior and returned system messages remain excluded from session history.
- Replaced session history and acknowledged only the captured transition after a successful main Agent result, then scheduled exactly one queue task with the exact current user text and final reply.
- Kept judge and manager calls in separate guarded stages. Judge failure returns from that task; write failure ends normally; the queue callback handles only unexpected task errors. All failures use `createMemoryWriteFailedEvent()`, and successful writes use `createMemoryWriteFinishedEvent()` so raw errors and manager write strings cannot cross IPC.
- Left New Chat scoped to `session.clear()`; it does not clear or recreate long-term memory services.

## TDD Evidence

Initial RED:

- Command: `npx.cmd vitest run tests/main/register-chat-ipc.test.ts`
- Result: 1 file failed; 8 failed and 9 passed out of 17 tests.
- Expected failures showed that recall was never called, recalled context and safe recall failures were absent, `ChatIpcRuntime` was undefined, queued judge/write work did not run, queue fallback reporting was absent, and a throwing sender rejected chat.
- The main-model failure regression already passed because the pre-Task-9 handler did not schedule memory at all; the new integration tests supplied the missing RED coverage for the feature.

Initial GREEN:

- Command: `npx.cmd vitest run tests/main/register-chat-ipc.test.ts`
- Result: 1 file and all 17 tests passed.

Self-review race RED:

- A deterministic deferred-recall test changed persona style while the older request awaited recall.
- Command: `npx.cmd vitest run tests/main/register-chat-ipc.test.ts`
- Result: 1 failed and 17 passed out of 18 tests.
- Evidence: the older request received `system:healing:steady` instead of its captured `system:default:steady`.
- Fix: capture `styleId` beside the transition before awaiting recall.

Final focused GREEN:

- Command: `npx.cmd vitest run tests/main/register-chat-ipc.test.ts`
- Result: 1 file and all 18 tests passed.

## Ordering Evidence

The deferred-judge test proves the reply resolves while the queue still reports one pending task and before `memoryManager.writeCandidates()` runs. After resolving the judge and flushing, the exact memory event order is:

```text
memory_recall_started
memory_recall_finished
memory_write_scheduled
memory_judge_started
memory_judge_finished
memory_write_finished
```

The same test proves the judge receives `{ userMessage: "Call me Alex", assistantReply: "Hello, Alex." }`, while the manager receives `{ userMessage: "Call me Alex", candidates: [validCandidate] }`. Separate two-turn tests prove one judge or write failure emits exactly one generic stage event and does not prevent the later queued task from reaching the manager.

## Verification

- Relevant behavior: `npx.cmd vitest run tests/main/register-chat-ipc.test.ts tests/main/chat-session.test.ts tests/prompts/prompt-composer.test.ts` passed, 3 files and 30 tests.
- Typecheck: `npm.cmd run typecheck` passed.
- Full suite, run once: `npx.cmd vitest run` passed, 43 files and 302 tests.
- Diff hygiene: `git diff --check` passed before the report was added; final diff and staged scope were reviewed before commit.

## Self-Review

- Recall failures degrade to persona-only chat and expose only the generic factory message.
- Main Agent failure leaves the transition pending and schedules no memory work or scheduled event.
- Existing overlapping transition coverage still verifies request-local transition use, and the deferred-recall test covers the added latency window.
- Session replacement still filters every system message, and New Chat removes first-turn history while recalling long-term memory for both user messages.
- Throwing event senders are absorbed for recall, Agent, scheduling, judge, and write events without stopping chat or queue completion.
- Factory filtering is exercised with an unsafe manager write string and secret-bearing raw errors; neither appears in emitted payloads.

Concerns: no blocking concerns. When recall succeeds without an explicit optional `retrievalMode` (the normal empty-L2 path), the lifecycle event reports `vector`; an explicit keyword fallback result remains reported as `keyword-fallback`.

## Shared Session Race Review Hardening

Status: complete
Commit: `fix: serialize chat session operations`

### Root Cause

All Chat IPC handlers shared one mutable `ChatSession`, but only the memory services had serial execution. A second send could append and snapshot history while the first send awaited recall or the main model, then either completion could replace the whole session. Likewise, `clearSession` could clear immediately and later be undone by an older model completion, while `setStyle` persistence and transition mutation could interleave with a send.

The fix creates one registration-scoped serial executor and routes the complete send session operation, clear, style mutation, and style reads through it. Each send captures its text, sender, and run ID before enqueueing; append, recall, prompt/model execution, session replacement, transition acknowledgement, and background-write scheduling then execute as one ordered operation. The executor resets its tail after both fulfillment and rejection so a failed model request or style save cannot poison later operations.

Serialization ends when `ChatSendResult` is ready. It does not await `MemoryJudge`, `MemoryManager`, or queue flush: the background write is scheduled before the session operation resolves and continues on the independent `MemoryWriteQueue`.

### Deterministic RED

- Command: `npx.cmd vitest run tests/main/register-chat-ipc.test.ts`
- Result: 1 file failed; 3 failed and 18 passed out of 21 tests.
- Concurrent sends: the second recall had already started before the first model was released (`2` calls instead of `1`), demonstrating that both requests could snapshot shared history concurrently.
- Deferred clear: `clearSession` settled before the older model completed (`true` instead of `false`), allowing stale completion to restore cleared messages.
- Deferred style change: style persistence settled while the older request still awaited recall (`true` instead of `false`), proving mutation ordering was not shared with sends.
- All gates used controlled promises and microtask checkpoints; no timers were used.

### Focused GREEN

- `npx.cmd vitest run tests/main/register-chat-ipc.test.ts` passed, 1 file and 21 tests.
- `npx.cmd vitest run tests/main/register-chat-ipc.test.ts tests/main/chat-session.test.ts tests/prompts/prompt-composer.test.ts` passed, 3 files and 33 tests.
- `npm.cmd run typecheck` passed.
- Full suite, run once: `npx.cmd vitest run` passed, 43 files and 305 tests.

### Concurrency Evidence

- Two sends invoked together retain invocation-order run IDs. Before the first deferred model resolves, only the first recall and model have started. The second model then receives the first user message, first assistant reply, and second user message; the pending style transition appears only on the first request.
- Clear requested during a deferred send remains pending. After the older send commits, clear runs and a following send receives no old chat history.
- Style change requested during deferred recall remains pending. The older request uses its original style, then the queued style save/mutation creates the transition consumed by the next send.
- While the first turn's `MemoryJudge` remains deferred, a second send reaches recall and the main model and returns. Queue flush later completes both judge tasks, proving session serialization does not include background memory execution.
- Memory failure events still use the Task 8 factories, safe sender delivery remains isolated, and judge/write failures still cannot poison later queued work.

Remaining Low: default service assembly is still primarily covered through injected seams and typechecking. The review's default-assembly coverage note is recorded here and intentionally not expanded as part of the shared-session race fix.
