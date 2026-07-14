# Phase 7C Memory Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic access reinforcement, recent-injection suppression, time decay, L1 expiry, and one serialized automatic maintenance scheduler without slowing or destabilizing chat.

**Architecture:** Pure lifecycle functions calculate changes from injected time, while transactional services apply them through MemoryStore. Recall chooses only eligible memory and schedules access updates after selection. A single MaintenanceCoordinator coalesces automatic/manual triggers and participates in the existing Electron shutdown barrier.

**Tech Stack:** TypeScript, Node.js timers/date arithmetic, existing MemoryStore/Recall/IPC services, Electron, Vitest.

## Global Constraints

- Lifecycle math must be deterministic from injected `now()` and idempotent for the same maintenance timestamp.
- Pinned memory always has weight 1 and never enters aging or archived automatically.
- Recall semantic similarity remains the primary rank signal; weight/pin/recent-injection are bounded modifiers.
- Main chat succeeds when reinforcement, decay, L1 expiry, scheduler, maintenance persistence, or audit fails.
- Only enabled active/aging L2 with valid sync state may be recalled.
- `active -> aging -> archived` is automatic; automatic lifecycle never moves memory to superseded or merged.
- L1 expiry uses per-field metadata and never expires L0.
- Recent-injection state is session-local and is not persisted.
- At most one full maintenance run executes at once; repeated triggers coalesce.
- Accepted maintenance work is included in Electron shutdown draining.
- All new behavior follows TDD and each task ends in a focused commit on local `main`.

---

### Task 1: Implement session-local RecentMemoryTracker

**Files:**
- Create: `src/main/memory/recent-memory-tracker.ts`
- Create: `tests/memory/recent-memory-tracker.test.ts`

**Interfaces:**
- Produces: `recordInjected(turnId, memoryIds)`, `penaltyFor(memoryId, semanticScore)`, `clear()`, and `snapshot()`.
- Consumes: no Store or model dependency.

- [ ] **Step 1: Write failing tracker tests**

Exact rules:

```ts
tracker.recordInjected("turn-1", ["m1", "m2"]);
tracker.recordInjected("turn-2", ["m1"]);
tracker.recordInjected("turn-3", ["m3"]);

expect(tracker.penaltyFor("m1", 0.60)).toBe(0.12);
expect(tracker.penaltyFor("m2", 0.60)).toBe(0.06);
expect(tracker.penaltyFor("m3", 0.60)).toBe(0.06);
expect(tracker.penaltyFor("m1", 0.80)).toBe(0);
```

Keep only three turns, dedupe IDs within a turn, and cap the penalty at 0.12. `clear()` returns the tracker to an empty snapshot.

- [ ] **Step 2: Run RED**

```powershell
npx.cmd vitest run tests/memory/recent-memory-tracker.test.ts
```

- [ ] **Step 3: Implement the bounded tracker**

Use an array of `{ turnId, ids: Set<string> }`; count how many retained turns contain the ID and return `Math.min(0.12, count * 0.06)` when semanticScore `< 0.80`.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npx.cmd vitest run tests/memory/recent-memory-tracker.test.ts
git add src/main/memory/recent-memory-tracker.ts tests/memory/recent-memory-tracker.test.ts
git commit -m "feat: track recently injected memories"
```

---

### Task 2: Add pure lifecycle math and access reinforcement

**Files:**
- Create: `src/main/memory/memory-lifecycle.ts`
- Create: `src/main/memory/memory-access-service.ts`
- Create: `tests/memory/memory-lifecycle.test.ts`
- Create: `tests/memory/memory-access-service.test.ts`

**Interfaces:**
- Produces: `calculateDecayedMemory()`, `reinforceMemory()`, and `MemoryAccessService.recordInjected(ids)`.
- Consumes: schema-v2 L2Memory and MemoryStore.

- [ ] **Step 1: Write exact decay tests**

Use exponential half-life:

```ts
nextWeight = currentWeight * Math.pow(0.5, elapsedDays / halfLifeDays);
```

Half-life is 45 days for medium, 90 for high, 180 for summary. Round persisted weight to six decimals. Assert:

- zero elapsed days leaves the object unchanged;
- one half-life halves weight;
- pinned returns weight 1 and unchanged status;
- `< 0.35` becomes aging;
- `< 0.15` plus at least 30 days since access becomes archived;
- archived/superseded/merged entries remain unchanged;
- disabled memory still decays because enabled is a recall preference, not lifecycle state.

- [ ] **Step 2: Write reinforcement tests**

For each actually injected active/aging ID:

```text
accessCount += 1
lastAccessedAt = now ISO
weight = min(1, weight + 0.05)
aging becomes active when new weight >= 0.40
pinned remains weight 1
```

Unknown, archived, merged, superseded, or disabled IDs are ignored. One transaction updates all supplied IDs and appends one metadata-only audit record.

- [ ] **Step 3: Run RED**

```powershell
npx.cmd vitest run tests/memory/memory-lifecycle.test.ts tests/memory/memory-access-service.test.ts
```

- [ ] **Step 4: Implement pure math and transactional access service**

Never mutate the input object in the pure function. `recordInjected()` dedupes IDs before Store update and returns `{ updatedIds }`.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npx.cmd vitest run tests/memory/memory-lifecycle.test.ts tests/memory/memory-access-service.test.ts
npm.cmd run typecheck
git add src/main/memory/memory-lifecycle.ts src/main/memory/memory-access-service.ts tests/memory/memory-lifecycle.test.ts tests/memory/memory-access-service.test.ts
git commit -m "feat: reinforce and decay episodic memory"
```

---

### Task 3: Implement idempotent decay and L1 expiry services

**Files:**
- Create: `src/main/memory/memory-decay-service.ts`
- Create: `src/main/memory/memory-l1-expiry.ts`
- Create: `tests/memory/memory-decay-service.test.ts`
- Create: `tests/memory/memory-l1-expiry.test.ts`

**Interfaces:**
- Produces: `runDecay(now): Promise<LifecycleSummary>` and `expireL1(now): Promise<L1ExpirySummary>`.
- Consumes: lifecycle math, L1 fieldMetadata, MemoryStore maintenance state.

- [ ] **Step 1: Write service-level idempotency tests**

Decay stores `maintenance.lastDecayAt`. A second call with the same `now` returns zero changes. A call less than 24 hours after lastDecayAt returns `{ skipped: true, reason: "interval" }`.

Test one transaction updates all eligible L2 and records counts only: activeToAging, agingToArchived, weightUpdated.

- [ ] **Step 2: Write L1 expiry boundary tests**

Thresholds from exact field metadata timestamps:

- `currentProject`: expire at 90 days;
- `recentGoals`: expire at 45 days;
- `recentPreferences`: expire at 30 days.

At threshold minus one millisecond retain; at threshold expire. Missing metadata does not expire migrated content until metadata exists. Expiry clears the field value and its metadata in one transaction.

- [ ] **Step 3: Run RED**

```powershell
npx.cmd vitest run tests/memory/memory-decay-service.test.ts tests/memory/memory-l1-expiry.test.ts
```

- [ ] **Step 4: Implement services**

Use injected `now(): Date`; reject invalid timestamps without modifying Store. Audit entries include counts and field names but no old values.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npx.cmd vitest run tests/memory/memory-decay-service.test.ts tests/memory/memory-l1-expiry.test.ts tests/memory/memory-store.test.ts
npm.cmd run typecheck
git add src/main/memory/memory-decay-service.ts src/main/memory/memory-l1-expiry.ts tests/memory/memory-decay-service.test.ts tests/memory/memory-l1-expiry.test.ts
git commit -m "feat: expire and age memory safely"
```

---

### Task 4: Upgrade Recall ranking, filtering, conflict rendering, and access updates

**Files:**
- Modify: `src/main/memory/memory-recall.ts`
- Modify: `src/main/memory/memory-context.ts`
- Modify: `src/main/app/register-chat-ipc.ts`
- Modify: `tests/memory/memory-recall.test.ts`
- Modify: `tests/memory/memory-context.test.ts`
- Modify: `tests/main/register-chat-ipc.test.ts`

**Interfaces:**
- Produces: ranked results with semanticScore/finalScore and asynchronous post-injection reinforcement.
- Consumes: `isRecallableL2()`, RecentMemoryTracker, MemoryAccessService.

- [ ] **Step 1: Write Recall filter/rank tests**

Filter disabled, archived, superseded, merged, unsynced summaries, and unknown index IDs before final output.

Use this bounded score:

```ts
const weightBoost = Math.min(0.08, memory.weight * 0.08);
const pinBoost = memory.isPinned ? 0.03 : 0;
const recentPenalty = tracker.penaltyFor(memory.id, semanticScore);
const finalScore = semanticScore + weightBoost + pinBoost - recentPenalty;
```

Still require raw semanticScore `>= 0.35`. Sort finalScore descending, semanticScore descending, ID ascending. Return at most three.

- [ ] **Step 2: Write context conflict tests**

When two recalled IDs share an unresolved/uncertain conflict log, output a fixed heading `未决记忆冲突` and list both as data. Do not include Resolver reason or raw Evidence.

- [ ] **Step 3: Write chat integration tests**

After the main Agent receives the memory context, schedule one best-effort access update for exactly the injected L2 IDs and record them in RecentMemoryTracker. Main reply resolves before access update finishes. New Chat clears the tracker but not persistent access counts.

- [ ] **Step 4: Run RED**

```powershell
npx.cmd vitest run tests/memory/memory-recall.test.ts tests/memory/memory-context.test.ts tests/main/register-chat-ipc.test.ts
```

- [ ] **Step 5: Implement and verify**

Reuse the existing background memory queue or a dedicated injected maintenance queue; errors emit fixed stage metadata and cannot reject chat.

```powershell
npx.cmd vitest run tests/memory/memory-recall.test.ts tests/memory/memory-context.test.ts tests/main/register-chat-ipc.test.ts
npm.cmd run typecheck
```

- [ ] **Step 6: Commit**

```powershell
git add src/main/memory/memory-recall.ts src/main/memory/memory-context.ts src/main/app/register-chat-ipc.ts tests/memory/memory-recall.test.ts tests/memory/memory-context.test.ts tests/main/register-chat-ipc.test.ts
git commit -m "feat: rank and reinforce recalled memory"
```

---

### Task 5: Build the coalescing MemoryScheduler and MaintenanceCoordinator

**Files:**
- Create: `src/main/memory/memory-scheduler.ts`
- Create: `src/main/memory/memory-maintenance.ts`
- Create: `tests/memory/memory-scheduler.test.ts`
- Create: `tests/memory/memory-maintenance.test.ts`

**Interfaces:**
- Produces: `recordSuccessfulWrite()`, `requestMaintenance(reason)`, `runNow()`, `pendingCount()`, `flush()`, and `beginShutdown()`.
- Consumes: Resolver queue, decay service, L1 expiry, and optional reflection/compression/entity callbacks. When a callback is absent in Phase 7C, the coordinator records `{ skipped: true, reason: "not_configured" }`; Phase 7D injects real implementations.

- [ ] **Step 1: Write scheduler trigger tests with fake timers**

Trigger full maintenance when successful writes reaches 10 or elapsed time since lastMaintenanceAt reaches 24 hours. Calls 1-9 do not trigger. Repeated requests while running coalesce into at most one follow-up run. `beginShutdown()` rejects new triggers and drains accepted work.

- [ ] **Step 2: Write fixed-order coordinator tests**

Assert call order exactly:

```ts
expect(calls).toEqual([
  "resolver-idle",
  "decay",
  "l1-expiry",
  "reflection",
  "compression",
  "entity-graph",
  "audit",
]);
```

If decay throws, record failure and skip destructive later steps except audit. If reflection throws, compression is skipped but entity graph and audit still run. Resolver failures do not prevent decay.

- [ ] **Step 3: Run RED**

```powershell
npx.cmd vitest run tests/memory/memory-scheduler.test.ts tests/memory/memory-maintenance.test.ts
```

- [ ] **Step 4: Implement stable serialized scheduling**

Persist `maintenance.running: true` only while a run is active and reset it in `finally`. On startup, stale `running: true` becomes false with a recovery audit entry. Store only fixed error codes in maintenance state.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npx.cmd vitest run tests/memory/memory-scheduler.test.ts tests/memory/memory-maintenance.test.ts
npm.cmd run typecheck
git add src/main/memory/memory-scheduler.ts src/main/memory/memory-maintenance.ts tests/memory/memory-scheduler.test.ts tests/memory/memory-maintenance.test.ts
git commit -m "feat: schedule serialized memory maintenance"
```

---

### Task 6: Integrate maintenance with IPC, UI, events, and shutdown

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/electron-api.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/app/register-chat-ipc.ts`
- Modify: `src/main/app/register-memory-ipc.ts`
- Modify: `src/main/app/main.ts`
- Modify: `src/main/app/background-memory-shutdown.ts`
- Modify: `src/main/agent/agent-events.ts`
- Modify: `src/renderer/chat/renderer-events.ts`
- Modify: `src/renderer/chat/memory-view.ts`
- Modify: `tests/main/register-chat-ipc.test.ts`
- Modify: `tests/main/register-memory-ipc.test.ts`
- Modify: `tests/main/background-memory-shutdown.test.ts`
- Create: `tests/integration/memory-lifecycle-maintenance.test.ts`

**Interfaces:**
- Produces: automatic write-count triggers, manual Run Maintenance action, lifecycle status visible in Events/Overview, and one combined shutdown barrier.
- Consumes: MemoryScheduler runtime.

- [ ] **Step 1: Write integration tests**

Cover:

- tenth successful memory write schedules maintenance after chat reply;
- manual IPC calls the same coalescing scheduler;
- repeated manual clicks return the current run ID, not parallel runs;
- lifecycle events expose counts only;
- before-quit waits accepted chat, resolver, and maintenance work;
- after shutdown begins, new maintenance IPC rejects.

- [ ] **Step 2: Run RED**

```powershell
npx.cmd vitest run tests/integration/memory-lifecycle-maintenance.test.ts
```

- [ ] **Step 3: Wire and render**

Add the `memory.runMaintenance` channel and matching `CyreneApi.memory`/Preload method in this task. Overview displays last maintenance time, next trigger count, status counts, and a Run Maintenance icon button with tooltip. Events include maintenance started/finished/failed and governance_changed without memory content.

- [ ] **Step 4: Verify Phase 7C**

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add src/shared/ipc-channels.ts src/shared/electron-api.ts src/preload/index.ts src/main/app/register-chat-ipc.ts src/main/app/register-memory-ipc.ts src/main/app/main.ts src/main/app/background-memory-shutdown.ts src/main/agent/agent-events.ts src/renderer/chat/renderer-events.ts src/renderer/chat/memory-view.ts tests/main/register-chat-ipc.test.ts tests/main/register-memory-ipc.test.ts tests/main/background-memory-shutdown.test.ts tests/integration/memory-lifecycle-maintenance.test.ts
git commit -m "feat: complete phase 7c memory lifecycle"
```
