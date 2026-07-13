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
- The original overlapping transition test remains unchanged and runs through injected empty recall; the new deferred-recall test covers the added latency window.
- Session replacement still filters every system message, and New Chat removes first-turn history while recalling long-term memory for both user messages.
- Throwing event senders are absorbed for recall, Agent, scheduling, judge, and write events without stopping chat or queue completion.
- Factory filtering is exercised with an unsafe manager write string and secret-bearing raw errors; neither appears in emitted payloads.

Concerns: no blocking concerns. When recall succeeds without an explicit optional `retrievalMode` (the normal empty-L2 path), the lifecycle event reports `vector`; an explicit keyword fallback result remains reported as `keyword-fallback`.
