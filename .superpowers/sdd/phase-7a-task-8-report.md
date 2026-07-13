# Phase 7A Task 8 Report

Status: complete
Commit: `feat: trace long-term memory lifecycle`

Implemented seven typed memory lifecycle events in `AgentEvent` and added exhaustive terminal and renderer formatter cases.

Tests:

- RED: the focused formatter tests failed with `undefined` for all seven new event cases before implementation.
- GREEN: `npx.cmd vitest run tests/agent/agent-events.test.ts tests/renderer/renderer-events.test.ts` passed, 8 tests.
- Full suite: `npx.cmd vitest run` passed, 43 files and 288 tests.
- Typecheck: `npm.cmd run typecheck` passed.

Concerns: memory formatter output intentionally reports only bounded lifecycle metadata, safe write keys, and generic stage messages. It omits candidate contents, evidence, secrets, and full memory payloads.

## Review Hardening

Status: complete

The event boundary now uses a finite `SafeMemoryWriteKey` union and `MemoryWriteFailureMessage` union. `filterSafeMemoryWriteKeys` preserves whitelist order while deduplicating untrusted input, and `getSafeMemoryWriteFailureMessage` maps each stage to a generic displayable message. Both formatters defensively re-filter keys and derive failure text from the stage.

Tests:

- RED: focused tests failed because the new boundary helpers were absent.
- GREEN: `npx.cmd vitest run tests/agent/agent-events.test.ts tests/renderer/renderer-events.test.ts` passed, 10 tests.
- Typecheck: `npm.cmd run typecheck` passed.
- Full suite: `npx.cmd vitest run` passed, 43 files and 290 tests.

The tests assert that rejected write strings and secret-bearing raw errors are absent from both the event payload and terminal/renderer output, while safe keys and generic failure messages remain visible.

## Alias-Mutation Re-review

Status: complete

The safe write-key helper and event payload now use readonly arrays. `createMemoryWriteFinishedEvent` copies, filters, deduplicates, freezes the stored key array, and freezes the event object. `createMemoryWriteFailedEvent` derives the fixed message from stage and ignores any supplied raw error.

Tests:

- RED: focused tests failed with `createMemoryWriteFinishedEvent is not a function` before the construction helpers existed.
- GREEN: `npx.cmd vitest run tests/agent/agent-events.test.ts tests/renderer/renderer-events.test.ts` passed, 12 tests.
- Typecheck: `npm.cmd run typecheck` passed.

Runtime coverage mutates the original input, attempts a push through a cast alias, verifies both event objects and the key array are frozen, and checks that sentinels and secret-bearing errors never enter the constructed payload.
