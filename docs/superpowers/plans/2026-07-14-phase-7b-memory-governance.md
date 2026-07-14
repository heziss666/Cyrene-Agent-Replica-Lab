# Phase 7B Memory Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate long-term memory to schema v2 and add safe CRUD, a complete Electron memory panel, deterministic conflict scoring, automatic DeepSeek resolution, and persistent audit data.

**Architecture:** `MemoryStore` remains the atomic authority. Migration, content policy, governance, conflict detection, scoring, resolving, and resolution application are separate modules. Renderer access is restricted to typed IPC methods exposed by Preload; model-produced resolutions are validated and applied by deterministic code.

**Tech Stack:** TypeScript 5.7, Node.js filesystem APIs, Electron IPC/contextBridge, Vite renderer, Vitest, DeepSeek through the existing OpenAI-compatible completion client, Ollama through the existing embedding provider.

## Global Constraints

- `memory.json` is the only authoritative memory data source.
- `memory-vector-index.json` remains a rebuildable cache and must stay separate from the worldbook index.
- Main chat must continue when migration recovery, governance refresh, conflict detection, Resolver, audit, or vector cleanup fails.
- Resolver output is untrusted and never receives a Store reference.
- Automatic resolution may not supersede, merge, disable, or delete pinned memory.
- Direct conflicts auto-apply only at resolution confidence `>= 0.85` with complete evidence on both sides.
- Credentials, payment data, identity numbers, passports, and exact addresses remain permanently forbidden, including through UI edits.
- Medical and legal content entered through the memory panel counts as explicit long-term opt-in.
- Deleting memory physically removes its evidence and must not copy deleted content into audit logs.
- Keep ConflictLog at 200 entries and AuditLog at 500 entries.
- All new behavior follows TDD and each task ends in a focused commit on local `main`.

---

### Task 1: Establish the Phase 7B baseline and shared schema-v2 types

**Files:**
- Modify: `src/main/memory/memory-types.ts`
- Create: `src/shared/memory-api-types.ts`
- Create: `tests/memory/memory-types.test.ts`

**Interfaces:**
- Produces: parallel `MemoryFileV1`/`MemoryFileV2` and `L2MemoryV1`/`L2MemoryV2` types, `MemoryEvidence`, `ConflictLog`, `MemoryAuditEntry`, `MemoryMaintenanceState`, and renderer-safe `MemorySnapshot`/mutation inputs.
- Consumes: existing `L0Profile`, `L1Profile`, and field unions. Keep the current `MemoryFile` and `L2Memory` runtime aliases on v1 in this task so the application remains green before migration exists; Task 2 switches the aliases and all consumers to v2 atomically.

- [ ] **Step 1: Verify the clean baseline**

Run:

```powershell
npm.cmd test
npm.cmd run typecheck
```

Expected: 44 test files and 350 tests pass; `tsc --noEmit` exits 0.

- [ ] **Step 2: Write failing type/runtime guard tests**

Create `tests/memory/memory-types.test.ts` with fixtures asserting these exact defaults:

```ts
expect(createEmptyMemoryFileV2()).toEqual({
  schemaVersion: 2,
  l0: { longTermInterests: [], permanentNotes: [], fieldMetadata: {} },
  l1: { recentGoals: [], recentPreferences: [], fieldMetadata: {} },
  l2: [],
  evidence: [],
  conflictLogs: [],
  reflectionLogs: [],
  auditLogs: [],
  maintenance: {
    successfulWritesSinceMaintenance: 0,
    running: false,
  },
});
```

Also instantiate one `L2MemoryV2` with all required v2 fields, including `sourceSnapshots: []`, and assert `isRecallableL2()` returns true only for enabled `active`/`aging` entries and false for `archived`, `superseded`, `merged`, disabled, or summary entries whose `syncStatus !== "synced"`.

- [ ] **Step 3: Run RED**

```powershell
npx.cmd vitest run tests/memory/memory-types.test.ts
```

Expected: FAIL because schema-v2 helpers do not exist.

- [ ] **Step 4: Define the exact v2 types and helpers**

Add the schema from the approved design. Required exported helpers:

```ts
export function createEmptyMemoryFileV2(): MemoryFile;
export function isRecallableL2(memory: L2MemoryV2): boolean;
export function initialMemoryWeight(
  importance: "medium" | "high",
  confidence: number,
  isSummary?: boolean,
): number;
```

`initialMemoryWeight()` returns `Math.min(1, Math.max(0, base * confidence))` with base `0.60` for medium, `0.85` for high, and minimum `0.75` for summaries.

Define renderer-safe DTOs in `src/shared/memory-api-types.ts`; do not export file paths, raw model output, or Store mutators. Do not modify Store, Manager, Recall, or existing v1 fixture behavior in Task 1.

- [ ] **Step 5: Run GREEN and typecheck**

```powershell
npx.cmd vitest run tests/memory/memory-types.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/main/memory/memory-types.ts src/shared/memory-api-types.ts tests/memory/memory-types.test.ts
git commit -m "feat: define phase 7 memory schema"
```

---

### Task 2: Add idempotent schema-v1 to schema-v2 migration

**Files:**
- Create: `src/main/memory/memory-migrations.ts`
- Modify: `src/main/memory/memory-store.ts`
- Modify: `src/main/memory/memory-manager.ts`
- Modify: `src/main/memory/memory-recall.ts`
- Create: `tests/memory/memory-migrations.test.ts`
- Modify: `tests/memory/memory-store.test.ts`
- Modify: `tests/memory/memory-manager.test.ts`
- Modify: `tests/memory/memory-recall.test.ts`
- Modify: `tests/main/register-chat-ipc.test.ts`

**Interfaces:**
- Produces: `migrateMemoryFile(value, now, idFactory): MemoryFileV2` and `migrateMemoryFileOnDisk(options): Promise<MemoryFileV2>`; switches the public `MemoryFile`/`L2Memory` aliases and all runtime consumers from v1 to v2 in the same task.
- Consumes: v1 structural parser retained privately in `memory-store.ts`, `writeFileAtomically()`, and `recoverInterruptedAtomicWrite()`.

- [ ] **Step 1: Write migration tests**

Cover these exact cases:

1. A v1 L2 becomes v2 with one Evidence whose quote/capturedAt equal the old embedded evidence.
2. Migration adds `updatedAt`, `lastAccessedAt`, `accessCount: 0`, initial weight, `isPinned: false`, `isEnabled: true`, `status: "active"`, `syncStatus: "pending_sync"`, and empty linkage arrays.
3. The backup name is `memory.pre-v2-<now>.json` and contains byte-for-byte original v1 content.
4. A v2 file returns unchanged and creates no backup.
5. A failed backup or atomic replacement leaves v1 readable.
6. Calling migration twice does not add Evidence or create a second backup.

Use injected `now: () => 1720944000000` and `idFactory: () => "evidence-1"` for exact assertions.

- [ ] **Step 2: Run RED**

```powershell
npx.cmd vitest run tests/memory/memory-migrations.test.ts tests/memory/memory-store.test.ts
```

Expected: migration test fails because the module does not exist.

- [ ] **Step 3: Implement pure migration first**

The pure function must:

```ts
if (isMemoryFileV2(value)) return structuredClone(value);
const v1 = validateMemoryFileV1(value);
return {
  schemaVersion: 2,
  l0: { ...v1.l0, fieldMetadata: metadataFrom(v1.l0.updatedAt) },
  l1: { ...v1.l1, fieldMetadata: metadataFrom(v1.l1.updatedAt) },
  l2: v1.l2.map(convertL2),
  evidence: v1.l2.map(convertEvidence),
  conflictLogs: [],
  reflectionLogs: [],
  auditLogs: [],
  maintenance: { successfulWritesSinceMaintenance: 0, running: false },
};
```

Generate one Evidence ID per L2 using the injected factory in iteration order.

- [ ] **Step 4: Integrate disk migration into cold load**

`MemoryStore.loadFromDisk()` order must be:

```text
recoverInterruptedAtomicWrite
-> read bytes
-> parse JSON
-> if v1: backup, migrate, validate v2, atomic write
-> if v2: validate v2
-> cache clone
```

Do not overwrite an existing pre-v2 backup with different bytes.

Update MemoryManager so every new L2 creates one Evidence record and all required v2 lifecycle/sync/linkage fields. Update Recall and typed test fixtures to use v2; keep expected user-visible recall behavior unchanged.

- [ ] **Step 5: Run GREEN**

```powershell
npx.cmd vitest run tests/memory/memory-migrations.test.ts tests/memory/memory-store.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/main/memory/memory-migrations.ts src/main/memory/memory-store.ts src/main/memory/memory-manager.ts src/main/memory/memory-recall.ts tests/memory/memory-migrations.test.ts tests/memory/memory-store.test.ts tests/memory/memory-manager.test.ts tests/memory/memory-recall.test.ts tests/main/register-chat-ipc.test.ts
git commit -m "feat: migrate memory store to schema v2"
```

---

### Task 3: Extract one reusable memory content policy

**Files:**
- Create: `src/main/memory/memory-content-policy.ts`
- Modify: `src/main/memory/memory-manager.ts`
- Create: `tests/memory/memory-content-policy.test.ts`
- Modify: `tests/memory/memory-manager.test.ts`

**Interfaces:**
- Produces: `normalizeMemoryContent()`, `validateModelMemoryContent()`, and `validateUserEditedMemoryContent()`.
- Consumes: no Store or model dependencies.

- [ ] **Step 1: Write policy tests before extraction**

Reuse the permanent-secret, address, SSN, medical/legal opt-in, evidence substring, negation, and Unicode cases from `memory-manager.test.ts`. Add UI-specific assertions:

```ts
expect(validateUserEditedMemoryContent("I have cancer")).toMatchObject({ ok: true });
expect(validateUserEditedMemoryContent("ghp_FAKE000000000000000000000000000000000"))
  .toEqual({ ok: false, code: "forbidden_sensitive_data" });
expect(validateUserEditedMemoryContent("   ")).toEqual({ ok: false, code: "empty" });
```

Set maximum normalized content length to 2,000 characters.

- [ ] **Step 2: Run RED**

```powershell
npx.cmd vitest run tests/memory/memory-content-policy.test.ts
```

- [ ] **Step 3: Move deterministic policy without behavior drift**

`validateModelMemoryContent()` accepts `{ userMessage, evidenceQuote, content }`; `validateUserEditedMemoryContent()` accepts only content and treats medical/legal content as explicit opt-in. Both permanently reject the same secret/identity/address patterns.

Return discriminated results:

```ts
type MemoryContentPolicyResult =
  | { ok: true; content: string }
  | { ok: false; code: "empty" | "too_long" | "unsupported_evidence" | "forbidden_sensitive_data" | "privacy_opt_in_required" };
```

Make `MemoryManager` delegate to this policy and delete duplicated regex/helpers from Manager.

- [ ] **Step 4: Run GREEN and full manager regression**

```powershell
npx.cmd vitest run tests/memory/memory-content-policy.test.ts tests/memory/memory-manager.test.ts
npm.cmd run typecheck
```

- [ ] **Step 5: Commit**

```powershell
git add src/main/memory/memory-content-policy.ts src/main/memory/memory-manager.ts tests/memory/memory-content-policy.test.ts tests/memory/memory-manager.test.ts
git commit -m "refactor: centralize memory content policy"
```

---

### Task 4: Implement MemoryGovernanceService and audit-safe CRUD

**Files:**
- Create: `src/main/memory/memory-governance.ts`
- Create: `src/main/memory/memory-audit.ts`
- Modify: `src/main/memory/memory-store.ts`
- Create: `tests/memory/memory-governance.test.ts`
- Create: `tests/memory/memory-audit.test.ts`

**Interfaces:**
- Produces: `MemoryGovernanceService` methods approved in the design and `auditMemoryFile(memory): MemoryAuditReport`.
- Consumes: `MemoryStore.update()`, user-edit content policy, `MemorySnapshot` DTOs.

- [ ] **Step 1: Write CRUD and cascade tests**

Cover exact behavior:

- update L0 string, L0 array, L1 string, and L1 array;
- metadata source is `user_edit` with injected ISO timestamp;
- update L2 resets `updatedAt`, sets `syncStatus: "pending_sync"`, and creates user_edit Evidence;
- pin sets weight 1 and blocks automatic state mutation;
- disabling leaves lifecycle status unchanged but excludes recall through `isRecallableL2()`;
- deleting L2 removes its Evidence and conflict markers;
- deleting a source of a summary disables the summary and sets `syncStatus: "sync_failed"`;
- clear L2 removes L2/evidence and makes conflict history non-executable without storing content;
- every success appends one AuditLog containing operation/target/source/timestamp/result but no memory content;
- no-op and missing ID return typed errors and do not append success logs.

- [ ] **Step 2: Run RED**

```powershell
npx.cmd vitest run tests/memory/memory-governance.test.ts tests/memory/memory-audit.test.ts
```

- [ ] **Step 3: Implement governance as one transaction per mutation**

Each public method validates input before `store.update()`. Inside the transaction, re-check ID/state to avoid stale UI writes. Return:

```ts
type MemoryMutationResult =
  | { ok: true; snapshot: MemorySnapshot }
  | { ok: false; code: "not_found" | "invalid_state" | "invalid_content"; message: string };
```

Trim logs after append using `slice(-limit)`. Audit rules flag missing Evidence, broken supersededBy/mergedInto, active conflict markers without live logs, and summaries with missing sources.

- [ ] **Step 4: Run GREEN**

```powershell
npx.cmd vitest run tests/memory/memory-governance.test.ts tests/memory/memory-audit.test.ts tests/memory/memory-store.test.ts
npm.cmd run typecheck
```

- [ ] **Step 5: Commit**

```powershell
git add src/main/memory/memory-governance.ts src/main/memory/memory-audit.ts src/main/memory/memory-store.ts tests/memory/memory-governance.test.ts tests/memory/memory-audit.test.ts
git commit -m "feat: add auditable memory governance"
```

---

### Task 5: Expose governance through typed Main/Preload IPC

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/electron-api.ts`
- Modify: `src/shared/memory-api-types.ts`
- Modify: `src/preload/index.ts`
- Create: `src/main/app/register-memory-ipc.ts`
- Modify: `src/main/app/main.ts`
- Create: `tests/main/register-memory-ipc.test.ts`
- Modify: `tests/shared/electron-api.test.ts`
- Modify: `tests/shared/ipc-channels.test.ts`

**Interfaces:**
- Produces: `CyreneApi.memory` and `registerMemoryIpc()` returning a shutdown-aware runtime.
- Consumes: `MemoryGovernanceService` and audit service. The maintenance channel is intentionally added in Phase 7C when a real scheduler exists.

- [ ] **Step 1: Write IPC contract tests**

Declare exact channels under `IPC_CHANNELS.memory`: getSnapshot, updateProfileField, updateL2, deleteProfileField, deleteL2, setPinned, setEnabled, restoreL2, clearLayer, getAuditReport.

Test that handlers reject malformed layer/field/id/boolean/content payloads before invoking governance. Test that beginShutdown rejects new operations and waits accepted operations.

- [ ] **Step 2: Run RED**

```powershell
npx.cmd vitest run tests/main/register-memory-ipc.test.ts tests/shared/electron-api.test.ts tests/shared/ipc-channels.test.ts
```

- [ ] **Step 3: Implement narrow API exposure**

Preload methods call only fixed `ipcRenderer.invoke()` channels. `registerMemoryIpc()` uses the same accepted-operation barrier pattern as chat IPC. Main combines chat and memory runtimes into one shutdown coordinator; do not create a second `before-quit` listener.

- [ ] **Step 4: Run GREEN and build Electron types**

```powershell
npx.cmd vitest run tests/main/register-memory-ipc.test.ts tests/shared/electron-api.test.ts tests/shared/ipc-channels.test.ts tests/main/background-memory-shutdown.test.ts
npm.cmd run typecheck
npm.cmd run build:electron
```

- [ ] **Step 5: Commit**

```powershell
git add src/shared/ipc-channels.ts src/shared/electron-api.ts src/shared/memory-api-types.ts src/preload/index.ts src/main/app/register-memory-ipc.ts src/main/app/main.ts tests/main/register-memory-ipc.test.ts tests/shared/electron-api.test.ts tests/shared/ipc-channels.test.ts tests/main/background-memory-shutdown.test.ts
git commit -m "feat: expose memory governance over ipc"
```

---

### Task 6: Build the complete Memory panel foundation

**Files:**
- Modify: `src/renderer/chat/index.html`
- Modify: `src/renderer/chat/main.ts`
- Modify: `src/renderer/chat/style.css`
- Create: `src/renderer/chat/memory-view-model.ts`
- Create: `src/renderer/chat/memory-view.ts`
- Create: `tests/renderer/memory-view-model.test.ts`
- Create: `tests/renderer/memory-view.test.ts`

**Interfaces:**
- Produces: Chat/Memory top-level view switch and Overview/Profile/Events/Conflicts/Reflections/Audit/Relations tabs.
- Consumes: `CyreneApi.memory` only.

- [ ] **Step 1: Write renderer model tests**

Test pure functions for:

- L2 text search, status filter, enabled filter, pinned filter;
- stable sorting by updatedAt, weight, accessCount, and status;
- overview counts;
- row edit state and validation error mapping;
- snapshot replacement after successful mutation.

- [ ] **Step 2: Write DOM behavior tests**

Under Vitest's existing renderer environment, construct the required DOM and assert:

- switching to Memory calls getSnapshot once and does not clear chat messages;
- Profile renders L0/L1 fields and saves through updateProfileField;
- Events renders edit, delete, pin, and enable controls;
- delete and clear require a confirmation dialog callback;
- failed mutation restores previous display and shows safe error text;
- loading, empty, and disabled states do not resize the layout.

- [ ] **Step 3: Run RED**

```powershell
npx.cmd vitest run tests/renderer/memory-view-model.test.ts tests/renderer/memory-view.test.ts
```

- [ ] **Step 4: Implement the operational UI**

Use compact full-width panels and tables; do not nest cards. Use native buttons with existing styling and title/aria-label tooltips. The first viewport must remain the actual Chat or Memory application, not a landing page.

Memory tab content must be generated with `textContent`, never interpolated through `innerHTML`.

- [ ] **Step 5: Run GREEN and renderer build**

```powershell
npx.cmd vitest run tests/renderer/memory-view-model.test.ts tests/renderer/memory-view.test.ts tests/renderer/style-selector.test.ts
npm.cmd run build:renderer
```

- [ ] **Step 6: Commit**

```powershell
git add src/renderer/chat/index.html src/renderer/chat/main.ts src/renderer/chat/style.css src/renderer/chat/memory-view-model.ts src/renderer/chat/memory-view.ts tests/renderer/memory-view-model.test.ts tests/renderer/memory-view.test.ts
git commit -m "feat: add memory governance panel"
```

---

### Task 7: Detect and score possible L2 conflicts

**Files:**
- Create: `src/main/memory/memory-conflict.ts`
- Create: `src/main/memory/memory-conflict-score.ts`
- Create: `src/main/memory/memory-conflict-service.ts`
- Modify: `src/main/memory/memory-manager.ts`
- Create: `tests/memory/memory-conflict.test.ts`
- Create: `tests/memory/memory-conflict-score.test.ts`
- Create: `tests/memory/memory-conflict-service.test.ts`

**Interfaces:**
- Produces: `findPossibleConflictCandidate()`, `scoreMemoryConflict()`, and `MemoryConflictService.inspectNewMemory(id)`.
- Consumes: current L2 list, Evidence, injected vector-neighbor provider, and recent-injection ID provider.

- [ ] **Step 1: Write deterministic detector tests**

Required examples:

```text
"I use Python" vs "I no longer use Python" -> correction/shared topic
"I prefer dark mode" vs "I now prefer light mode" -> preference evolution candidate
"I visited Beijing" vs "I studied Python" -> no candidate
identical normalized content -> duplicate, not conflict
```

- [ ] **Step 2: Write score boundary tests**

Assert exact priorities at 34/35, 54/55, and 74/75. Penalize missing Evidence and vague token-only overlap. Pinned target adds a protection signal but does not by itself create conflict.

- [ ] **Step 3: Run RED**

```powershell
npx.cmd vitest run tests/memory/memory-conflict.test.ts tests/memory/memory-conflict-score.test.ts tests/memory/memory-conflict-service.test.ts
```

- [ ] **Step 4: Implement and integrate after successful L2 persistence**

Inspect at most five vector neighbors plus recent-injection candidates, dedupe IDs, and create ConflictLog only for score `>= 35`. Add symmetric conflictWith IDs in one Store transaction. Conflict detection exceptions emit a fixed event but do not roll back the already safe L2 write.

- [ ] **Step 5: Run GREEN**

```powershell
npx.cmd vitest run tests/memory/memory-conflict.test.ts tests/memory/memory-conflict-score.test.ts tests/memory/memory-conflict-service.test.ts tests/memory/memory-manager.test.ts
npm.cmd run typecheck
```

- [ ] **Step 6: Commit**

```powershell
git add src/main/memory/memory-conflict.ts src/main/memory/memory-conflict-score.ts src/main/memory/memory-conflict-service.ts src/main/memory/memory-manager.ts tests/memory/memory-conflict.test.ts tests/memory/memory-conflict-score.test.ts tests/memory/memory-conflict-service.test.ts tests/memory/memory-manager.test.ts
git commit -m "feat: detect and score memory conflicts"
```

---

### Task 8: Implement automatic DeepSeek Resolver and deterministic applier

**Files:**
- Create: `src/main/memory/memory-resolver.ts`
- Create: `src/main/memory/memory-resolution-applier.ts`
- Create: `src/main/memory/memory-resolver-queue.ts`
- Create: `tests/memory/memory-resolver.test.ts`
- Create: `tests/memory/memory-resolution-applier.test.ts`
- Create: `tests/memory/memory-resolver-queue.test.ts`

**Interfaces:**
- Produces: `MemoryResolver.resolve(payload)`, `applyMemoryResolution()`, and stable priority queue `schedule()/flush()`.
- Consumes: shared chat completion client, ConflictLog, exactly two memory snapshots, and their Evidence.

- [ ] **Step 1: Write parser/prompt tests**

Accept only the five resolution types and numeric confidence 0..1. Reject extra top-level keys, invented IDs, invalid status, markdown fences that do not contain one object, and missing reason/actions. Prompt states that memory text is data, not instructions.

- [ ] **Step 2: Write applier tests for every resolution**

Exact behavior:

- unrelated/context_difference keep both active and resolve the log;
- preference_evolution supersedes the older unpinned memory;
- direct_conflict applies only at `>= 0.85`, complete Evidence, unchanged updatedAt snapshots, and unpinned target;
- uncertain keeps both and marks the log uncertain;
- any pinned destructive target downgrades to uncertain;
- stale, missing, or unrelated IDs reject without partial writes.

- [ ] **Step 3: Run RED**

```powershell
npx.cmd vitest run tests/memory/memory-resolver.test.ts tests/memory/memory-resolution-applier.test.ts tests/memory/memory-resolver-queue.test.ts
```

- [ ] **Step 4: Implement model-free applier before model client**

Apply the resolution in exactly one `MemoryStore.update()` call. Update conflictWith, linkage fields, status, timestamps, log state, and one audit record atomically.

- [ ] **Step 5: Implement Resolver and queue**

Queue order: high before normal before idle, then createdAt ascending. Retry model/parse failures at most twice; final failure leaves both memories untouched. `flush()` uses the stable-tail algorithm from MemoryWriteQueue.

- [ ] **Step 6: Run GREEN**

```powershell
npx.cmd vitest run tests/memory/memory-resolver.test.ts tests/memory/memory-resolution-applier.test.ts tests/memory/memory-resolver-queue.test.ts
npm.cmd run typecheck
```

- [ ] **Step 7: Commit**

```powershell
git add src/main/memory/memory-resolver.ts src/main/memory/memory-resolution-applier.ts src/main/memory/memory-resolver-queue.ts tests/memory/memory-resolver.test.ts tests/memory/memory-resolution-applier.test.ts tests/memory/memory-resolver-queue.test.ts
git commit -m "feat: resolve memory conflicts automatically"
```

---

### Task 9: Integrate Resolver, audit/conflict views, events, and Phase 7B acceptance

**Files:**
- Modify: `src/main/app/register-chat-ipc.ts`
- Modify: `src/main/app/register-memory-ipc.ts`
- Modify: `src/main/app/background-memory-shutdown.ts`
- Modify: `src/main/agent/agent-events.ts`
- Modify: `src/renderer/chat/renderer-events.ts`
- Modify: `src/renderer/chat/memory-view.ts`
- Modify: `tests/main/register-chat-ipc.test.ts`
- Modify: `tests/main/register-memory-ipc.test.ts`
- Modify: `tests/agent/agent-events.test.ts`
- Modify: `tests/renderer/renderer-events.test.ts`
- Create: `tests/integration/memory-conflict-resolution.test.ts`

**Interfaces:**
- Produces: complete Phase 7B runtime and visible conflict/audit state.
- Consumes: conflict service, resolver queue, governance snapshot, and combined shutdown barrier.

- [ ] **Step 1: Write integration tests**

Scenario:

```text
existing: "I prefer dark mode"
new: "I now prefer light mode"
-> conflict log created
-> resolver returns preference_evolution at 0.93
-> old superseded, new active
-> recall excludes old
-> UI snapshot shows resolved conflict
```

Also test Resolver failure leaves both active, pinned old memory becomes uncertain, and shutdown waits an accepted Resolver operation.

- [ ] **Step 2: Run RED**

```powershell
npx.cmd vitest run tests/integration/memory-conflict-resolution.test.ts
```

- [ ] **Step 3: Wire runtime and safe events**

Add conflict_detected and resolver started/finished/failed event factories with IDs/counts/status only. Renderer formats them without content. The Memory view refreshes after governance_changed and resolver_finished.

- [ ] **Step 4: Complete UI tabs**

Conflicts shows score, priority, state, resolution type, confidence, and timestamps. Audit shows finding code/severity/target ID. Do not render model reason as HTML.

- [ ] **Step 5: Verify Phase 7B**

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```powershell
git add src/main/app/register-chat-ipc.ts src/main/app/register-memory-ipc.ts src/main/app/background-memory-shutdown.ts src/main/agent/agent-events.ts src/renderer/chat/renderer-events.ts src/renderer/chat/memory-view.ts tests/main/register-chat-ipc.test.ts tests/main/register-memory-ipc.test.ts tests/agent/agent-events.test.ts tests/renderer/renderer-events.test.ts tests/integration/memory-conflict-resolution.test.ts
git commit -m "feat: complete phase 7b memory governance"
```
