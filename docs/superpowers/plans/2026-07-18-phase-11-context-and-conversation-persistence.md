# Phase 11 Context Management and Conversation Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent, isolated multi-session chat plus token-budgeted context assembly and current-session history retrieval without deleting raw transcripts.

**Architecture:** Store one versioned JSON fact file per conversation behind `ConversationStore` and expose lifecycle rules through `ConversationService`. Before each Agent run, `ContextManager` combines system context, structured summary, pinned messages, retrieved old turns, and recent complete turns within a conservative token budget. Derived summaries and vectors are asynchronous and rebuildable; Electron management operations use a separate conversations IPC boundary.

**Tech Stack:** TypeScript 5.7, Electron 43, Vitest 2, Node.js filesystem APIs, Zod 4, Ollama Embeddings, Vite.

## Global Constraints

- Full raw conversation messages must not be deleted by summarization or context trimming.
- History retrieval defaults to the active conversation only; no automatic cross-conversation retrieval.
- Conversation messages, summaries, pinned messages, pending persona transitions, and selected persona are isolated by `conversationId`.
- L0/L1/L2 memory, RAG, Skills, MCP, and Scheduler remain globally shared.
- Conversation JSON is the fact source; list indexes, summaries, and vector indexes are rebuildable derived data.
- The first implementation remains JSON-based and adds no runtime dependency or SQLite database.
- Ollama and summarization failures must not block ordinary chat.
- A conversation may have at most one active Agent run, and Phase 11 permits at most one model run globally.
- All manual edits use ASCII identifiers and existing project formatting; user-facing interface copy may remain Chinese or match the current English UI.

---

## File Structure

### New production files

- `src/shared/conversation-types.ts`: Renderer-safe conversation records, message views, IPC inputs, and results.
- `src/main/config/conversation-config.ts`: storage paths, context limits, thresholds, and environment parsing.
- `src/main/conversations/conversation-types.ts`: persisted schema and conversion helpers for `ChatMessage`.
- `src/main/conversations/conversation-migrations.ts`: schema validation and version migration entry point.
- `src/main/conversations/conversation-store.ts`: atomic per-session JSON storage, index rebuild, quarantine, and serialized writes.
- `src/main/conversations/conversation-title.ts`: deterministic first-message title generation.
- `src/main/conversations/conversation-service.ts`: lifecycle, active session, append/finalize/fail, persona, and pin rules.
- `src/main/context/token-estimator.ts`: conservative message and tool-schema token estimates.
- `src/main/context/conversation-turns.ts`: preserve complete model/tool protocol turns.
- `src/main/context/conversation-summarizer.ts`: validated incremental structured summaries.
- `src/main/context/conversation-vector-index.ts`: scoped, atomic conversation history vectors.
- `src/main/context/conversation-history-retriever.ts`: turn chunking, vector/keyword retrieval, ranking, and fallback.
- `src/main/context/context-manager.ts`: final budget allocation and model-facing message assembly.
- `src/main/app/register-conversation-ipc.ts`: conversation management handlers.
- `src/renderer/chat/conversation-view-model.ts`: renderer state transitions and stale-result routing.
- `src/renderer/chat/conversation-view.ts`: conversation sidebar DOM.

### Existing production files to modify

- `src/main/app/register-chat-ipc.ts`: replace `ChatSession` with conversation/context services and structured send payloads.
- `src/main/app/main.ts`: build and initialize the Phase 11 runtime and register shutdown.
- `src/main/app/background-memory-shutdown.ts`: generalize the shutdown runtime name without changing behavior.
- `src/shared/ipc-channels.ts`: add conversation channels.
- `src/shared/electron-api.ts`: add `conversations` API and conversation-aware chat/event contracts.
- `src/preload/index.ts`: expose the allowlisted conversations API.
- `src/renderer/chat/index.html`: add the conversation sidebar and menu roots.
- `src/renderer/chat/main.ts`: load/switch/render persistent conversations and route asynchronous results.
- `src/renderer/chat/style-selector.ts`: read and write style by conversation.
- `src/renderer/chat/style.css`: responsive three-column layout and fixed toolbar.
- `.env.example`: document context configuration.

### Files removed after replacement

- `src/main/chat/chat-session.ts`
- `tests/main/chat-session.test.ts`

---

### Task 1: Shared Contracts and Conversation Configuration

**Files:**
- Create: `src/shared/conversation-types.ts`
- Create: `src/main/config/conversation-config.ts`
- Modify: `src/shared/electron-api.ts`
- Test: `tests/config/conversation-config.test.ts`
- Test: `tests/shared/conversation-types.test.ts`

**Interfaces:**
- Produces: `ConversationSummaryView`, `ConversationMessageView`, `ConversationListItem`, `ConversationDetail`, `ConversationSendInput`, and CRUD input/result types.
- Produces: `loadConversationConfig(env, userDataDir): ConversationConfig`.

- [ ] **Step 1: Write failing contract and config tests**

```ts
it("builds userData conversation paths and conservative defaults", () => {
  expect(loadConversationConfig({}, "C:/user-data")).toMatchObject({
    rootDir: expect.stringMatching(/conversations$/),
    contextWindowTokens: 32768,
    outputReserveTokens: 4096,
    toolGrowthReserveTokens: 8192,
    summaryTriggerTokens: 6000,
    recentTurnTokens: 6000,
  });
});

it("rejects reserves that consume the context window", () => {
  expect(() => loadConversationConfig({
    CYRENE_MODEL_CONTEXT_TOKENS: "4096",
    CYRENE_MODEL_OUTPUT_RESERVE_TOKENS: "4096",
  }, "C:/user-data")).toThrow("CYRENE_CONVERSATION_TOKEN_BUDGET_INVALID");
});
```

- [ ] **Step 2: Run the tests and verify missing-module failures**

Run: `npx vitest run tests/config/conversation-config.test.ts tests/shared/conversation-types.test.ts`

Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Add exact shared contracts and environment parsing**

Define `ConversationSendInput` as `{ conversationId: string; requestId: string; text: string }`. Define `ConversationMessageView` with `id`, `role: "user" | "assistant"`, `content`, `createdAt`, `status`, and `isPinned`; tool protocol messages remain persistence-only. Parse positive integers for:

Extend `ChatAgentEventPayload` with optional `conversationId` and `requestId` because Scheduler and maintenance events are not attached to a conversation. The chat handler must always populate both fields.

```text
CYRENE_MODEL_CONTEXT_TOKENS=32768
CYRENE_MODEL_OUTPUT_RESERVE_TOKENS=4096
CYRENE_AGENT_TOOL_GROWTH_RESERVE_TOKENS=8192
CYRENE_CONVERSATION_SUMMARY_TRIGGER_TOKENS=6000
CYRENE_CONVERSATION_RECENT_TURN_TOKENS=6000
```

Reject non-integers, non-positive values, and any configuration where output plus tool reserve leaves fewer than 4096 input tokens.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx vitest run tests/config/conversation-config.test.ts tests/shared/conversation-types.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/conversation-types.ts src/shared/electron-api.ts src/main/config/conversation-config.ts tests/config/conversation-config.test.ts tests/shared/conversation-types.test.ts
git commit -m "feat: define persistent conversation contracts"
```

### Task 2: Persisted Schema, Migration, and Atomic Store

**Files:**
- Create: `src/main/conversations/conversation-types.ts`
- Create: `src/main/conversations/conversation-migrations.ts`
- Create: `src/main/conversations/conversation-store.ts`
- Test: `tests/conversations/conversation-migrations.test.ts`
- Test: `tests/conversations/conversation-store.test.ts`

**Interfaces:**
- Produces: `createEmptyConversation`, `toChatMessages`, and `toConversationMessage`.
- Produces: `ConversationStore.initialize/list/load/save/remove/setActive/getActiveId/flush`.
- Consumes: `writeFileAtomically` and `recoverInterruptedAtomicWrite` from `src/main/rag/atomic-file-write.ts`.

- [ ] **Step 1: Write failing schema and store tests**

Cover exact cases: initialize creates directories; one file per session; save/load round-trip preserves tool fields; writes to the same ID serialize; missing `index.json` rebuilds from sessions; invalid session moves to `corrupt`; deleting one conversation leaves another untouched; `flush()` waits for queued writes.

```ts
it("rebuilds a missing index from valid session files", async () => {
  await writeConversationFixture(root, conversation("conv_a", "A"));
  const store = createConversationStore({ rootDir: root });
  const result = await store.initialize();
  expect(result.rebuiltIndex).toBe(true);
  expect((await store.list()).map(({ id }) => id)).toEqual(["conv_a"]);
});
```

- [ ] **Step 2: Verify tests fail before implementation**

Run: `npx vitest run tests/conversations/conversation-migrations.test.ts tests/conversations/conversation-store.test.ts`

Expected: FAIL with unresolved imports.

- [ ] **Step 3: Implement schema validation and the store**

Use schema version `1`. The index contains only `schemaVersion`, `activeConversationId`, and list metadata. Session files contain the complete `ConversationRecord`. Validate all parsed unknown data before use. Quarantine invalid files using a timestamped filename under `corrupt/`. Keep a `Map<string, Promise<void>>` tail so saves for one ID execute in order, and use a separate index tail for index writes.

- [ ] **Step 4: Run store tests and atomic-file regression tests**

Run: `npx vitest run tests/conversations tests/rag/atomic-file-write.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/conversations tests/conversations
git commit -m "feat: persist versioned conversation records"
```

### Task 3: Conversation Lifecycle Service

**Files:**
- Create: `src/main/conversations/conversation-title.ts`
- Create: `src/main/conversations/conversation-service.ts`
- Test: `tests/conversations/conversation-title.test.ts`
- Test: `tests/conversations/conversation-service.test.ts`

**Interfaces:**
- Produces: `ConversationService.initialize/list/get/create/setActive/rename/remove/appendPendingUserMessage/completeRun/failRun/setStyle/acknowledgeStyleTransition/setMessagePinned/flush`.
- Consumes: `ConversationStore` from Task 2 and default `StyleId`.

- [ ] **Step 1: Write lifecycle tests**

Test first-run default creation, restoring active ID, deterministic title generation, per-conversation style isolation, pin validation, pending-to-complete and pending-to-failed transitions, deleting the active conversation, and rejecting a second pending run in the same conversation.

```ts
it("keeps persona state isolated", async () => {
  const a = await service.create("default");
  const b = await service.create("default");
  await service.setStyle(a.id, "cyrene-original");
  expect((await service.get(a.id)).styleId).toBe("cyrene-original");
  expect((await service.get(b.id)).styleId).toBe("default");
});
```

- [ ] **Step 2: Verify failing tests**

Run: `npx vitest run tests/conversations/conversation-title.test.ts tests/conversations/conversation-service.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement lifecycle rules**

Generate IDs with injected factories in tests and `randomUUID()` in production. Save the pending user message before returning from `appendPendingUserMessage`. `completeRun` atomically replaces that message status and appends all assistant/tool messages returned by the Agent. `failRun` marks only the matching `requestId`. Generate a title from the first non-empty user message by collapsing whitespace, removing leading punctuation, and limiting display length to 24 Unicode code points.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/conversations`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/conversations tests/conversations
git commit -m "feat: manage isolated conversation lifecycles"
```

### Task 4: Token Estimation and Complete Turn Selection

**Files:**
- Create: `src/main/context/token-estimator.ts`
- Create: `src/main/context/conversation-turns.ts`
- Test: `tests/context/token-estimator.test.ts`
- Test: `tests/context/conversation-turns.test.ts`

**Interfaces:**
- Produces: `TokenEstimator.estimateText/estimateMessages/estimateTools`.
- Produces: `groupConversationTurns(messages)` and `selectRecentCompleteTurns(turns, budget, estimator)`.

- [ ] **Step 1: Write failing estimator and protocol grouping tests**

Test deterministic estimates for empty, Chinese, English, and mixed text; include role/tool schema overhead. Verify that `assistant.toolCalls`, matching `tool` messages, and final assistant reply remain in one turn and that an oversized turn is omitted whole rather than split.

```ts
expect(groupConversationTurns([
  user("calculate"),
  assistantToolCall("call_1"),
  toolResult("call_1"),
  assistant("42"),
])).toHaveLength(1);
```

- [ ] **Step 2: Verify failing tests**

Run: `npx vitest run tests/context/token-estimator.test.ts tests/context/conversation-turns.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement conservative estimation and turn grouping**

Count CJK code points as one token each, other non-whitespace characters as one token per four characters, and add fixed overhead per message, tool call, and tool specification. Round upward and never return a negative estimate. A turn starts at a user message and includes all following assistant/tool messages until the next user message.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/context/token-estimator.test.ts tests/context/conversation-turns.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/context/token-estimator.ts src/main/context/conversation-turns.ts tests/context
git commit -m "feat: budget complete conversation turns"
```

### Task 5: Incremental Structured Conversation Summaries

**Files:**
- Create: `src/main/context/conversation-summarizer.ts`
- Test: `tests/context/conversation-summarizer.test.ts`

**Interfaces:**
- Produces: `ConversationSummarizer.shouldSummarize(record)` and `summarize(record): Promise<SummarizeResult>` where `SummarizeResult` is `{ status: "updated"; summary: ConversationSummary } | { status: "skipped" | "failed"; summary: ConversationSummary; code?: string }`.
- Consumes: existing `complete()` client, `VendorAdapter`, model config provider, and Task 4 estimator.

- [ ] **Step 1: Write summarizer tests**

Test threshold behavior, exclusion of recent protected turns, input containing only the previous summary plus newly covered messages, strict JSON validation, source cursor advancement, no cursor advancement on invalid output, and retention of the old summary on model failure.

- [ ] **Step 2: Verify failing tests**

Run: `npx vitest run tests/context/conversation-summarizer.test.ts`

Expected: FAIL with unresolved module.

- [ ] **Step 3: Implement the summarizer**

Send one system instruction requiring exactly the fields from `ConversationSummary`. Treat all transcript text as untrusted evidence. Limit each string, reject unknown keys and IDs outside the supplied source slice, normalize duplicate list entries, and set `coveredThroughMessageId` to the final successfully summarized source message. Return the existing summary unchanged on API or validation failure and expose the failure to the caller as a structured result rather than throwing into chat.

- [ ] **Step 4: Run focused and vendor regression tests**

Run: `npx vitest run tests/context/conversation-summarizer.test.ts tests/vendors/chat-completion-client.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/context/conversation-summarizer.ts tests/context/conversation-summarizer.test.ts
git commit -m "feat: summarize old conversation turns incrementally"
```

### Task 6: Scoped Conversation Vector Index

**Files:**
- Create: `src/main/context/conversation-vector-index.ts`
- Test: `tests/context/conversation-vector-index.test.ts`

**Interfaces:**
- Produces: `ConversationVectorIndex.initialize/get/addMany/pruneConversation/removeConversation/clear/flush`.
- Entry identity: `{ conversationId, chunkId, textHash }`; file identity includes provider ID, model, dimensions, and schema version.

- [ ] **Step 1: Write index tests**

Cover atomic persistence, current-conversation pruning that preserves other conversations, model/dimension incompatibility, corrupt-file reset, delete scope, and serialized mutation ordering.

- [ ] **Step 2: Verify failing tests**

Run: `npx vitest run tests/context/conversation-vector-index.test.ts`

Expected: FAIL with unresolved module.

- [ ] **Step 3: Implement the scoped derived index**

Reuse atomic file helpers and cosine-compatible vectors, but do not reuse `VectorIndex.prune()` because it is globally scoped. Store all entries in one file and require `conversationId` for every mutation except full clear. Return `missing`, `loaded`, `incompatible`, or `corrupt` initialization status. An incompatible or corrupt index is rebuildable and must never delete conversation JSON.

- [ ] **Step 4: Run focused and RAG index regression tests**

Run: `npx vitest run tests/context/conversation-vector-index.test.ts tests/rag/json-vector-index.test.ts tests/rag/vector-math.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/context/conversation-vector-index.ts tests/context/conversation-vector-index.test.ts
git commit -m "feat: persist scoped conversation history vectors"
```

### Task 7: History Chunking, Hybrid Retrieval, and Fallback

**Files:**
- Create: `src/main/context/conversation-history-retriever.ts`
- Test: `tests/context/conversation-history-retriever.test.ts`

**Interfaces:**
- Produces: `indexConversation(record)`, `retrieve({ record, query, recentMessageIds, pinnedMessageIds, topK })`, `removeConversation(id)`, and `flush()`.
- Consumes: `EmbeddingProvider`, `ConversationVectorIndex`, `cosineSimilarity`, and turn grouping.

- [ ] **Step 1: Write retrieval tests**

Test user-plus-final-answer chunks, omission of raw tool payloads, paragraph splitting of oversized turns, contextual query construction from the current question and preceding turn, vector relevance, keyword recovery for exact identifiers, reciprocal-rank fusion, current-conversation filtering, deduplication, chronological output ordering, and keyword-only fallback when Embedding throws.

```ts
expect(await retriever.retrieve({
  record: conversationA,
  query: "ToolRegistry 在哪里注册？",
  recentMessageIds: new Set(),
  pinnedMessageIds: new Set(),
  topK: 4,
})).toEqual(expect.arrayContaining([
  expect.objectContaining({ conversationId: "conv_a", turnId: "turn_old" }),
]));
```

- [ ] **Step 2: Verify failing tests**

Run: `npx vitest run tests/context/conversation-history-retriever.test.ts`

Expected: FAIL with unresolved module.

- [ ] **Step 3: Implement indexing and retrieval**

Index only completed turns. Build embedding text from user text, assistant final text, and tool names; sanitize and omit raw tool outputs. Split overlong text by paragraphs with stable child IDs. Generate missing document vectors in the background path. At query time, embed `previous topic + current question`, score with cosine similarity, obtain an exact-term keyword ranking, fuse ranks with reciprocal-rank fusion, discard low relevance and excluded message IDs, cap at five results, and sort selected excerpts chronologically. On any embedding failure, return keyword results with `mode: "keyword"`.

- [ ] **Step 4: Run context and Ollama provider tests**

Run: `npx vitest run tests/context tests/rag/ollama-embedding-provider.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/context/conversation-history-retriever.ts tests/context/conversation-history-retriever.test.ts
git commit -m "feat: retrieve relevant conversation history"
```

### Task 8: Context Manager Orchestration

**Files:**
- Create: `src/main/context/context-manager.ts`
- Test: `tests/context/context-manager.test.ts`

**Interfaces:**
- Produces: `ContextManager.build({ record, systemPrompt, tools, currentRequestId }): Promise<ContextBuildResult>`.
- Produces: model-ready `messages`, estimates, selected message IDs, retrieval mode, and `summaryRecommended`.
- Consumes: Tasks 4, 5, and 7.

- [ ] **Step 1: Write end-to-end selection tests**

Test short histories remain verbatim; system/current user are always retained; pinned messages precede ordinary archive excerpts; recent complete turns are protected; duplicate retrieved messages are excluded; low-priority history is dropped before protected inputs; tool growth/output reserves are respected; and impossible pinned content returns `CONVERSATION_PINNED_CONTENT_EXCEEDS_BUDGET` rather than silently deleting it.

- [ ] **Step 2: Verify failing tests**

Run: `npx vitest run tests/context/context-manager.test.ts`

Expected: FAIL with unresolved module.

- [ ] **Step 3: Implement deterministic budget allocation**

Calculate `inputBudget = contextWindow - outputReserve - toolGrowthReserve - estimateTools(tools)`. Build one controlled system message with explicit sections for persona/global memory, session summary, pinned historical evidence, and retrieved historical evidence. Mark quoted history as untrusted background, preserve source times, then append recent raw `ChatMessage` turns and the current pending user message. Re-estimate the final request and remove only lower-priority retrieved excerpts or older unpinned turns until it fits.

- [ ] **Step 4: Run all context tests**

Run: `npx vitest run tests/context`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/context/context-manager.ts tests/context/context-manager.test.ts
git commit -m "feat: assemble token-budgeted agent context"
```

### Task 9: Conversation IPC and Preload Boundary

**Files:**
- Create: `src/main/app/register-conversation-ipc.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/electron-api.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/main/register-conversation-ipc.test.ts`
- Modify: `tests/shared/ipc-channels.test.ts`
- Modify: `tests/shared/electron-api.test.ts`

**Interfaces:**
- Produces: `registerConversationIpc({ ipcMain, service, onChanged })`.
- Exposes: `window.cyrene.conversations` with list/create/get/setActive/rename/delete/setMessagePinned/onChanged.

- [ ] **Step 1: Write failing IPC and API exposure tests**

Test every exact channel name, payload validation, unknown conversation errors, title length validation, pin input validation, changed notifications, handler disposal, and that preload exposes functions rather than raw `ipcRenderer`.

- [ ] **Step 2: Verify failing tests**

Run: `npx vitest run tests/main/register-conversation-ipc.test.ts tests/shared/ipc-channels.test.ts tests/shared/electron-api.test.ts`

Expected: FAIL because the channels and registration do not exist.

- [ ] **Step 3: Implement the IPC allowlist**

Add the seven invoke channels plus `cyrene:conversations:changed`. Validate payloads before calling `ConversationService`. Broadcast only list metadata in changed events. Return structured error codes such as `CONVERSATION_NOT_FOUND`, `CONVERSATION_TITLE_INVALID`, and `CONVERSATION_MESSAGE_NOT_FOUND`.

- [ ] **Step 4: Run focused tests and Electron typecheck**

Run: `npx vitest run tests/main/register-conversation-ipc.test.ts tests/shared && npm run build:electron`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/app/register-conversation-ipc.ts src/shared src/preload/index.ts tests/main/register-conversation-ipc.test.ts tests/shared
git commit -m "feat: expose persistent conversations through IPC"
```

### Task 10: Integrate Persistence and Context into Chat Runs

**Files:**
- Modify: `src/main/app/register-chat-ipc.ts`
- Delete: `src/main/chat/chat-session.ts`
- Delete: `tests/main/chat-session.test.ts`
- Modify: `tests/main/register-chat-ipc.test.ts`

**Interfaces:**
- `registerChatIpc` consumes `ConversationService`, `ContextManager`, `ConversationSummarizer`, and `ConversationHistoryRetriever`.
- Chat input and all event/result payloads carry `conversationId` and `requestId`.

- [ ] **Step 1: Adapt tests before production code**

Replace string send payloads with `{ conversationId, requestId, text }`. Add tests proving the user message is persisted before `runAgent`, successful tool protocol messages are finalized, failure marks the pending request, summary/index jobs run only after persistence, global concurrent sends reject with `CHAT_RUN_IN_PROGRESS`, style transition is acknowledged only for the source conversation, and an A response remains associated with A after active session changes to B.

- [ ] **Step 2: Run the focused suite and verify failures**

Run: `npx vitest run tests/main/register-chat-ipc.test.ts`

Expected: FAIL because the existing handler accepts only a string and uses `ChatSession`.

- [ ] **Step 3: Replace in-memory session coordination**

Within the send handler: validate the structured payload; acquire the global run guard; persist a pending user message; recall global memory; compose persona/skills/manual skill/memory system text; call `ContextManager.build`; execute `runToolAgent`; persist only newly generated assistant/tool messages with `completeRun`; acknowledge that conversation's transition; then schedule existing long-term memory write, conversation summary, and history indexing. On model error call `failRun` before rethrowing. Include IDs in every renderer event. Remove `clearSession` after the new-conversation flow is wired.

- [ ] **Step 4: Delete the obsolete ChatSession and run regressions**

Run: `npx vitest run tests/main/register-chat-ipc.test.ts tests/agent tests/memory tests/prompts && npm run build:electron`

Expected: PASS and no import of `src/main/chat/chat-session.ts` remains (`rg "chat-session|createChatSession" src tests` returns no matches).

- [ ] **Step 5: Commit**

```bash
git add src/main/app/register-chat-ipc.ts tests/main/register-chat-ipc.test.ts
git rm src/main/chat/chat-session.ts tests/main/chat-session.test.ts
git commit -m "feat: run chats from persistent conversation context"
```

### Task 11: Boot Runtime, Recovery, and Shutdown

**Files:**
- Modify: `src/main/app/main.ts`
- Modify: `src/main/app/background-memory-shutdown.ts`
- Modify: `tests/main/background-memory-shutdown.test.ts`
- Modify: `.env.example`
- Test: `tests/integration/conversation-runtime.test.ts`

**Interfaces:**
- Main creates one shared Conversation runtime and injects it into both IPC registrations.
- Combined shutdown waits for raw conversation saves and applies a bounded wait to rebuildable summary/vector work.

- [ ] **Step 1: Write runtime integration tests**

Use a temporary userData directory and fake model/embedding dependencies. Test first boot creation, active-session restoration after a second initialization, pending-run recovery, index rebuild, Ollama failure fallback, and shutdown waiting for a delayed conversation save.

- [ ] **Step 2: Verify failing integration tests**

Run: `npx vitest run tests/integration/conversation-runtime.test.ts tests/main/background-memory-shutdown.test.ts`

Expected: FAIL before boot wiring.

- [ ] **Step 3: Wire the runtime and generalize shutdown naming**

Construct config from Electron `userData`; initialize the store/service before creating the window; create the scoped vector index and history retriever from the existing Ollama provider; register conversations and chat IPC with the same service; combine their `flush`/pending counts with existing runtime shutdown. Rename type-only `BackgroundMemory` terminology to `BackgroundTask` while preserving exported behavior or update all call sites atomically. Document the five Phase 11 environment variables in `.env.example`.

- [ ] **Step 4: Run integration tests and build**

Run: `npx vitest run tests/integration/conversation-runtime.test.ts tests/main/background-memory-shutdown.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/app/main.ts src/main/app/background-memory-shutdown.ts tests/main/background-memory-shutdown.test.ts tests/integration/conversation-runtime.test.ts .env.example
git commit -m "feat: initialize and flush conversation runtime"
```

### Task 12: Multi-Conversation Renderer

**Files:**
- Create: `src/renderer/chat/conversation-view-model.ts`
- Create: `src/renderer/chat/conversation-view.ts`
- Modify: `src/renderer/chat/index.html`
- Modify: `src/renderer/chat/main.ts`
- Modify: `src/renderer/chat/style-selector.ts`
- Modify: `src/renderer/chat/style.css`
- Test: `tests/renderer/conversation-view-model.test.ts`
- Test: `tests/renderer/conversation-view.test.ts`
- Modify: `tests/renderer/style-selector.test.ts`

**Interfaces:**
- Produces: renderer state containing `activeConversationId`, list items, active detail, global busy run IDs, and unread completion IDs.
- Consumes: `window.cyrene.conversations`, conversation-aware chat, and persona APIs.

- [ ] **Step 1: Write renderer state and DOM tests**

Test initial loading, create/switch/rename/delete, active persona refresh, message rendering from persisted detail, A-result routing while B is active, unread marker behavior, long-title truncation, delete confirmation, and disabled send while the global run guard is active.

- [ ] **Step 2: Verify failing tests**

Run: `npx vitest run tests/renderer/conversation-view-model.test.ts tests/renderer/conversation-view.test.ts tests/renderer/style-selector.test.ts`

Expected: FAIL because the view modules do not exist.

- [ ] **Step 3: Implement the sidebar and renderer routing**

Add a fixed-width conversation sidebar inside the chat workspace, an icon-based new button with tooltip, a title filter, list rows with title/preview/time/status, and an accessible menu for rename/delete. On switch, fetch the detail and replace the message DOM from persisted user/assistant views. Keep tool protocol messages hidden from the ordinary transcript. Route result/event payloads by `conversationId`; only append to the visible transcript when IDs match. Replace current `clearSession()` New Chat behavior with `conversations.create()`.

- [ ] **Step 4: Implement responsive styling and run renderer tests**

Use stable grid tracks for sidebar/chat/event panes, fixed topbar, independent scroll containers, ellipsis for titles, and a collapsible sidebar below the narrow breakpoint. Do not nest cards or introduce decorative gradients. Run: `npx vitest run tests/renderer && npm run build:renderer`.

Expected: PASS and Vite emits the chat bundle.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/chat tests/renderer
git commit -m "feat: add persistent multi-conversation interface"
```

### Task 13: Full Verification and Learning Documentation

**Files:**
- Create: `docs/learning/phase-11-context-and-multi-session.zh-CN.md`
- Modify only if verification exposes defects: Phase 11 source/tests from Tasks 1-12.

**Interfaces:**
- Produces: a Chinese learning guide that traces one message from Renderer through IPC, storage, context selection, Agent Loop, persistence, summary, and vector indexing.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: all Vitest suites pass.

- [ ] **Step 2: Run static and production build checks**

Run: `npm run typecheck && npm run build && npm run test:electron-smoke`

Expected: all commands exit `0`.

- [ ] **Step 3: Perform Electron visual verification**

Run `npm run dev:electron`, then verify desktop and narrow window screenshots: fixed topbar; no overlap; independent scrolling; long titles fit; sidebar collapses; conversation switching restores messages and persona; sending in A then viewing B never displays A's result in B. Inspect renderer console and terminal for uncaught errors.

- [ ] **Step 4: Perform persistence and degradation smoke tests**

Create two conversations with different personas, restart Electron, and verify both restore. Stop Ollama, send a message, and verify chat succeeds with keyword history mode. Restart Ollama and verify missing vectors rebuild. Temporarily copy an invalid session fixture into the test userData directory and verify it moves to `corrupt/` without hiding valid sessions.

- [ ] **Step 5: Write the Chinese learning guide**

Document the plain-language purpose first, then professional names and exact file relationships. Include the persisted JSON example, Token budget arithmetic, incremental summary flow, current-session vector retrieval, IPC path, failure downgrade table, and a Python pseudocode translation of `ContextManager.build()`.

- [ ] **Step 6: Re-run final checks and commit**

Run: `git diff --check && npm test && npm run build`

Expected: no whitespace errors, all tests pass, and build exits `0`.

```bash
git add docs/learning/phase-11-context-and-multi-session.zh-CN.md src tests .env.example
git commit -m "docs: explain persistent conversation context"
```

---

## Final Acceptance Checklist

- [ ] Multiple conversations can be created, switched, renamed, and deleted.
- [ ] Restart restores messages, active conversation, and per-conversation persona.
- [ ] Raw messages survive summarization and context trimming.
- [ ] Context requests remain inside configured reserves and keep tool protocol turns valid.
- [ ] Pinned content is protected or produces an explicit over-budget error.
- [ ] Relevant old turns are retrieved only from the current conversation.
- [ ] Ollama, summary, and derived-index failures degrade without blocking chat.
- [ ] Asynchronous results and events never appear in the wrong conversation.
- [ ] Corrupt derived data rebuilds and corrupt fact files are quarantined.
- [ ] Existing Agent, memory, RAG, Skills, MCP, Scheduler, IPC, renderer, and build tests pass.
