# Phase 7D Memory Reflection, Compression, and Entity Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add evidence-linked Reflection, safe profile promotion, deterministic semantic clustering, verified two-stage memory compression, and a rebuildable entity graph, then finish Phase 7 documentation and real-environment acceptance.

**Architecture:** Reflection and Compressor are proposal-only model clients. Every proposal contains existing source IDs and atomic claims; a separate verifier and deterministic validators gate application. Compression creates a disabled pending summary, syncs its vector, and only then activates the summary and merges sources. Entity graph is derived from active memory and can be deleted/rebuilt without data loss.

**Tech Stack:** TypeScript, existing chat completion client, Ollama embedding provider, cosine similarity utilities, JSON vector index, MemoryStore schema v2, Electron/Vite/Vitest.

## Global Constraints

- Reflection, verifier, Compressor, and entity extractor outputs are untrusted.
- Every abstract claim must reference existing sourceMemoryIds and Evidence IDs.
- L0 promotion needs at least three source memories, three distinct capture times or a seven-day span, and verifier confidence `>= 0.90`.
- L1 promotion needs verifier confidence `>= 0.85`.
- Existing L0 fields whose metadata source is `user_edit` cannot be overwritten automatically.
- Compression eligibility requires at least three enabled, unpinned, non-summary active/aging L2 with similarity `>= 0.82` and no unresolved direct conflict.
- Compression verification needs confidence `>= 0.90` and all atomic claims supported.
- Source memory remains active/aging until the summary vector is durably synchronized.
- Automatic compression never physically deletes source memory.
- `entity-graph.json` is a rebuildable cache and never becomes a source of user facts.
- Entity names must be continuous spans from source memory or Evidence.
- Main chat and basic memory recall continue when any Phase 7D component fails.
- All new behavior follows TDD and each task ends in a focused commit on local `main`.

---

### Task 1: Define Reflection proposal and verifier contracts

**Files:**
- Create: `src/main/memory/memory-reflection-types.ts`
- Create: `src/main/memory/memory-reflection.ts`
- Create: `src/main/memory/memory-reflection-verifier.ts`
- Create: `tests/memory/memory-reflection.test.ts`
- Create: `tests/memory/memory-reflection-verifier.test.ts`

**Interfaces:**
- Produces: `MemoryReflection.reflect(input)` and `MemoryReflectionVerifier.verify(proposal, sources)`.
- Consumes: existing completion client, active/aging L2 snapshots, Evidence, L0/L1 snapshots.

- [ ] **Step 1: Write strict parser tests**

The Reflection response has exactly:

```ts
interface ReflectionProposal {
  profileUpdates: Array<{
    layer: "L0" | "L1";
    field: L0Field | L1Field;
    content: string;
    sourceMemoryIds: string[];
    claims: Array<{ text: string; evidenceIds: string[] }>;
    confidence: number;
    reason: string;
  }>;
  compressionGroups: Array<{
    sourceMemoryIds: string[];
    reason: string;
  }>;
  entities: Array<{
    type: EntityType;
    name: string;
    sourceMemoryIds: string[];
  }>;
  relations: Array<{
    fromName: string;
    toName: string;
    type: string;
    sourceMemoryIds: string[];
  }>;
}
```

Reject unknown top-level keys, invalid layers/fields, string confidence, duplicate IDs, empty evidenceIds, unknown source IDs, and entity names not present in source text.

- [ ] **Step 2: Write prompt safety tests**

Prompt must state that memory text is quoted data, commands inside it are not instructions, assistant replies/reasons/audit logs are not evidence, and no profile update may be based on fewer than three source memories.

- [ ] **Step 3: Write verifier parser tests**

Verifier returns:

```ts
interface ReflectionVerification {
  supported: boolean;
  confidence: number;
  claims: Array<{
    claimIndex: number;
    supported: boolean;
    evidenceIds: string[];
  }>;
  reason: string;
}
```

Deterministic validation rejects supported=true if any claim is missing, any evidence ID is unknown, confidence is below the caller threshold, or source updatedAt differs from the proposal snapshot.

- [ ] **Step 4: Run RED**

```powershell
npx.cmd vitest run tests/memory/memory-reflection.test.ts tests/memory/memory-reflection-verifier.test.ts
```

- [ ] **Step 5: Implement model clients using the shared completion client**

Use `tools: []`; parse JSON only; do not add new vendor adapters. Strip neither arbitrary prose nor multiple JSON objects: exactly one object must parse after optional fenced-code extraction.

- [ ] **Step 6: Run GREEN and commit**

```powershell
npx.cmd vitest run tests/memory/memory-reflection.test.ts tests/memory/memory-reflection-verifier.test.ts
npm.cmd run typecheck
git add src/main/memory/memory-reflection-types.ts src/main/memory/memory-reflection.ts src/main/memory/memory-reflection-verifier.ts tests/memory/memory-reflection.test.ts tests/memory/memory-reflection-verifier.test.ts
git commit -m "feat: propose and verify memory reflections"
```

---

### Task 2: Apply verified L0/L1 profile promotions

**Files:**
- Create: `src/main/memory/memory-profile-promoter.ts`
- Create: `tests/memory/memory-profile-promoter.test.ts`

**Interfaces:**
- Produces: `applyProfileUpdates(proposals, verificationByProposal): Promise<PromotionSummary>`.
- Consumes: MemoryStore, content policy, source memories/Evidence, injected time.

- [ ] **Step 1: Write promotion threshold tests**

L0 acceptance requires:

- at least three unique source IDs;
- all sources exist and remain active/aging;
- source timestamps span seven days OR contain at least three distinct capturedAt values;
- verifier supported and confidence `>= 0.90`;
- model proposal confidence `>= 0.90`;
- content policy passes;
- existing field metadata source is not user_edit.

L1 uses verifier/proposal confidence `>= 0.85` and at least two unique source IDs. Arrays append normalized-unique content; single fields replace. One Store transaction applies all still-valid proposals and logs accepted/skipped counts without content.

- [ ] **Step 2: Write stale/pinned-equivalent protection tests**

Reject when source updatedAt changed after Reflection, Evidence disappeared, field became user_edit, or proposal references a summary whose sources are missing.

- [ ] **Step 3: Run RED**

```powershell
npx.cmd vitest run tests/memory/memory-profile-promoter.test.ts
```

- [ ] **Step 4: Implement deterministic promotion**

Set fieldMetadata source `reflection`, confidence from verifier, and updatedAt from injected now. Append one ReflectionLog per accepted update with type `l0_update` or `l1_update`, field name, source IDs, and no full Evidence text.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npx.cmd vitest run tests/memory/memory-profile-promoter.test.ts tests/memory/memory-content-policy.test.ts
npm.cmd run typecheck
git add src/main/memory/memory-profile-promoter.ts tests/memory/memory-profile-promoter.test.ts
git commit -m "feat: promote verified memory patterns"
```

---

### Task 3: Build deterministic semantic clustering

**Files:**
- Create: `src/main/memory/memory-clustering.ts`
- Create: `tests/memory/memory-clustering.test.ts`

**Interfaces:**
- Produces: `clusterMemories(memories, vectors, options): MemoryCluster[]` and `eligibleCompressionMemories(memoryFile)`.
- Consumes: existing `cosineSimilarity()` and embeddings generated in one batch by the maintenance service.

- [ ] **Step 1: Write eligibility tests**

Exclude pinned, disabled, summary, archived, superseded, merged, pending/failed sync, and unresolved direct-conflict memory. Include enabled synced active/aging non-summary memory.

- [ ] **Step 2: Write connected-component clustering tests**

Create vectors where A-B=0.90, B-C=0.85, A-C=0.80. With threshold 0.82, the connected component is `[A,B,C]`. Sort IDs inside clusters and clusters by first ID. Drop groups smaller than three. A memory belongs to only one cluster.

Reject non-finite vectors and dimension mismatches before clustering.

- [ ] **Step 3: Run RED**

```powershell
npx.cmd vitest run tests/memory/memory-clustering.test.ts
```

- [ ] **Step 4: Implement O(n²) union-find clustering**

The learning project intentionally uses deterministic linear/pairwise logic; do not introduce an ANN or graph dependency. Return cluster centroid as the arithmetic mean for diagnostics, but do not persist it in memory.json.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npx.cmd vitest run tests/memory/memory-clustering.test.ts tests/rag/vector-math.test.ts
git add src/main/memory/memory-clustering.ts tests/memory/memory-clustering.test.ts
git commit -m "feat: cluster related episodic memories"
```

---

### Task 4: Implement Compressor proposals and claim verification

**Files:**
- Create: `src/main/memory/memory-compressor.ts`
- Create: `src/main/memory/memory-compression-verifier.ts`
- Create: `tests/memory/memory-compressor.test.ts`
- Create: `tests/memory/memory-compression-verifier.test.ts`

**Interfaces:**
- Produces: `compressCluster(cluster, sources, evidence)` and `verifyCompression(proposal, sources, evidence)`.
- Consumes: shared completion client and strict reflection claim types.

- [ ] **Step 1: Write Compressor response tests**

Required output:

```ts
interface CompressionProposal {
  summary: string;
  sourceMemoryIds: string[];
  evidenceIds: string[];
  claims: Array<{ text: string; evidenceIds: string[] }>;
  confidence: number;
  importance: "medium" | "high";
  reason: string;
}
```

Reject fewer than three source IDs, IDs outside the provided cluster, duplicate IDs, missing claims, unsupported importance, summary over 2,000 normalized characters, and permanent-sensitive data.

- [ ] **Step 2: Write verifier threshold tests**

Accept only when every claim is supported, all evidence IDs exist and belong to sourceMemoryIds, verifier confidence `>= 0.90`, proposal confidence `>= 0.90`, and source snapshots remain unchanged. Explicitly reject converting “sometimes” into “always” when Evidence lacks the absolute term.

- [ ] **Step 3: Run RED**

```powershell
npx.cmd vitest run tests/memory/memory-compressor.test.ts tests/memory/memory-compression-verifier.test.ts
```

- [ ] **Step 4: Implement proposal/verifier clients**

Use separate prompts and separate completion calls. A successful Compressor call with failed verification is a skipped compression, not a runtime error.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npx.cmd vitest run tests/memory/memory-compressor.test.ts tests/memory/memory-compression-verifier.test.ts
npm.cmd run typecheck
git add src/main/memory/memory-compressor.ts src/main/memory/memory-compression-verifier.ts tests/memory/memory-compressor.test.ts tests/memory/memory-compression-verifier.test.ts
git commit -m "feat: propose verified memory summaries"
```

---

### Task 5: Implement two-stage summary persistence and vector synchronization

**Files:**
- Create: `src/main/memory/memory-compression-service.ts`
- Create: `src/main/memory/memory-summary-sync.ts`
- Modify: `src/main/memory/memory-recall.ts`
- Create: `tests/memory/memory-compression-service.test.ts`
- Create: `tests/memory/memory-summary-sync.test.ts`
- Modify: `tests/memory/memory-recall.test.ts`

**Interfaces:**
- Produces: `compressEligibleMemories()` and `retryPendingSummarySync()`.
- Consumes: embedding provider, vector index/KnowledgeBase factory, clustering, Compressor, verifier, MemoryStore.

- [ ] **Step 1: Write two-stage success tests**

Assert operation order:

```text
create disabled pending summary
-> persist Store
-> embed/sync summary vector
-> persist index
-> transaction: summary enabled+synced, sources merged+mergedInto
```

Summary Evidence has source `reflection`, empty quote, and sourceMemoryIds/evidenceIds linking all originals. ReflectionLog type is compression.

- [ ] **Step 2: Write every failure-boundary test**

- Compressor failure: no Store change.
- Verifier failure: no Store change.
- pending-summary Store failure: no index change.
- embedding/index failure: summary becomes sync_failed and disabled; sources unchanged.
- source updated after pending creation: remove/disable pending summary; sources unchanged.
- final Store transaction failure: sources unchanged; next maintenance repeats the idempotent vector upsert, then retries finalization.
- retry sync does not call Compressor again.

- [ ] **Step 3: Run RED**

```powershell
npx.cmd vitest run tests/memory/memory-compression-service.test.ts tests/memory/memory-summary-sync.test.ts
```

- [ ] **Step 4: Implement explicit pending state machine**

Store source snapshot IDs and updatedAt values in the pending summary's `sourceSnapshots` field. Before finalization, compare every source again. Recall excludes disabled/unsynced summary and continues returning original sources.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npx.cmd vitest run tests/memory/memory-compression-service.test.ts tests/memory/memory-summary-sync.test.ts tests/memory/memory-recall.test.ts tests/rag/vector-index-persistence.test.ts
npm.cmd run typecheck
git add src/main/memory/memory-compression-service.ts src/main/memory/memory-summary-sync.ts src/main/memory/memory-recall.ts tests/memory/memory-compression-service.test.ts tests/memory/memory-summary-sync.test.ts tests/memory/memory-recall.test.ts
git commit -m "feat: compress memory with two-stage sync"
```

---

### Task 6: Build the rebuildable entity graph

**Files:**
- Create: `src/main/memory/entity-graph-types.ts`
- Create: `src/main/memory/entity-graph.ts`
- Create: `src/main/memory/entity-graph-extractor.ts`
- Create: `tests/memory/entity-graph.test.ts`
- Create: `tests/memory/entity-graph-extractor.test.ts`

**Interfaces:**
- Produces: `EntityGraphService.rebuild(memoryFile)`, `load()`, `snapshot()`, and strict extractor validation.
- Consumes: active/aging enabled memory, Evidence, reflection entity/relation proposals, and atomic file writer.

- [ ] **Step 1: Write extractor tests**

Allowed node types: user, person, project, technology, place, organization, event, topic. Entity name must be a normalized continuous substring of at least one listed source memory or Evidence. Relation endpoints must resolve to accepted entity names; source IDs must be a non-empty subset of both endpoint provenance sets.

- [ ] **Step 2: Write graph persistence/rebuild tests**

Test deterministic IDs from normalized `type:name`, node/relation dedupe, source ID union, stale source pruning, corrupt graph quarantine, empty rebuild, atomic persistence, and failure leaving the previous valid graph readable.

- [ ] **Step 3: Run RED**

```powershell
npx.cmd vitest run tests/memory/entity-graph.test.ts tests/memory/entity-graph-extractor.test.ts
```

- [ ] **Step 4: Implement graph as derived cache**

Default path: `join(dirname(defaultMemoryPath()), "entity-graph.json")`, normally `~/.cyrene-agent-replica-lab/entity-graph.json`, adjacent to `memory.json`. Do not add graph content to memory.json. Graph search may expand candidate IDs but never directly inject node/relationship text into Prompt.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npx.cmd vitest run tests/memory/entity-graph.test.ts tests/memory/entity-graph-extractor.test.ts
npm.cmd run typecheck
git add src/main/memory/entity-graph-types.ts src/main/memory/entity-graph.ts src/main/memory/entity-graph-extractor.ts tests/memory/entity-graph.test.ts tests/memory/entity-graph-extractor.test.ts
git commit -m "feat: derive memory entity graph"
```

---

### Task 7: Integrate Reflection, compression, graph, events, and UI

**Files:**
- Modify: `src/main/memory/memory-maintenance.ts`
- Modify: `src/main/app/register-memory-ipc.ts`
- Modify: `src/main/agent/agent-events.ts`
- Modify: `src/renderer/chat/renderer-events.ts`
- Modify: `src/renderer/chat/memory-view.ts`
- Modify: `src/shared/memory-api-types.ts`
- Modify: `tests/memory/memory-maintenance.test.ts`
- Modify: `tests/main/register-memory-ipc.test.ts`
- Modify: `tests/agent/agent-events.test.ts`
- Create: `tests/integration/memory-reflection-compression.test.ts`

**Interfaces:**
- Produces: complete maintenance pipeline and Reflections/Relations UI tabs.
- Consumes: all Phase 7D services.

- [ ] **Step 1: Write full maintenance integration tests**

Scenario:

```text
three related active memories with Evidence
-> Reflection proposal verified
-> eligible cluster compressed
-> pending summary synchronized
-> summary active/synced
-> sources merged
-> entity graph rebuilt from summary+remaining active memory
-> audit finds no broken links
```

Also test verifier rejection, Ollama offline, source mutation race, graph persistence failure, and maintenance re-run idempotency.

- [ ] **Step 2: Run RED**

```powershell
npx.cmd vitest run tests/integration/memory-reflection-compression.test.ts
```

- [ ] **Step 3: Wire fixed-order maintenance callbacks**

Reflection returns one batch reused by promotion, compression group hints, and entity extraction. Deterministic clustering remains authoritative for compression eligibility. Add safe events containing proposed/accepted/skipped counts only.

- [ ] **Step 4: Complete Reflections and Relations views**

Reflections displays type, timestamp, accepted/skipped counts, and source IDs. Relations displays filterable node and relation tables; do not add a graph rendering dependency. Both views handle stale snapshot refresh and empty/error states.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npx.cmd vitest run tests/integration/memory-reflection-compression.test.ts tests/memory/memory-maintenance.test.ts tests/main/register-memory-ipc.test.ts tests/agent/agent-events.test.ts
npm.cmd run typecheck
npm.cmd run build
git add src/main/memory/memory-maintenance.ts src/main/app/register-memory-ipc.ts src/main/agent/agent-events.ts src/renderer/chat/renderer-events.ts src/renderer/chat/memory-view.ts src/shared/memory-api-types.ts tests/memory/memory-maintenance.test.ts tests/main/register-memory-ipc.test.ts tests/agent/agent-events.test.ts tests/integration/memory-reflection-compression.test.ts
git commit -m "feat: integrate intelligent memory maintenance"
```

---

### Task 8: Write the Chinese Phase 7 guide and execute final acceptance

**Files:**
- Create: `docs/learning/phase-07-complete-memory-system.zh-CN.md`
- Modify: `docs/learning/00-overall-replica-roadmap.zh-CN.md`
- Modify: `README.md`
- Create: `.superpowers/sdd/phase-7-final-acceptance.md` (ignored execution record)

**Interfaces:**
- Produces: beginner-readable technical guide and repeatable acceptance record.
- Consumes: final implementation and all tests.

- [ ] **Step 1: Write the complete Chinese guide**

The guide must explain with TypeScript/Python comparisons:

- schema v2 and migration;
- governance/IPC/Preload/Renderer flow;
- conflict detector, score, Resolver, and applier separation;
- lifecycle math and idempotency;
- recent-injection suppression;
- Scheduler and shutdown barrier;
- Reflection proposal/verifier/promotion;
- clustering and two-stage compression;
- entity graph authority boundary;
- every UI tab, event, data file, test file, and failure path;
- exact manual test steps and expected files.

- [ ] **Step 2: Run fresh automated verification**

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:embedding
git diff --check
```

Record test file/test counts and command exit codes.

- [ ] **Step 3: Run real DeepSeek/Ollama service acceptance**

Use fake personal facts only:

1. Store a stable L0 fact and an L2 event.
2. Restart and recall both.
3. Introduce a preference evolution conflict and verify automatic resolution.
4. Create three related events and run maintenance.
5. Verify summary appears only after vector sync and sources become merged afterward.
6. Stop Ollama during a second compression attempt and verify sources remain recallable.
7. Verify forbidden fake credential never reaches memory.json or logs.

- [ ] **Step 4: Run Electron UI acceptance**

Verify Chat/Memory switching, all Profile/Event mutations, pin/enable, delete confirmation, conflict result, maintenance status, Reflection/Relation/Audit tabs, restart persistence, and no renderer console error. Check desktop and a narrow resized window for overlap.

- [ ] **Step 5: Inspect data integrity**

Confirm:

```text
memory.json schemaVersion = 2
memory.pre-v2 backup exists only after real v1 migration
memory-vector-index.json excludes deleted/disabled/merged source entries as designed
entity-graph.json is rebuildable
no audit/event payload contains full Evidence or API keys
no Electron process remains after exit
```

- [ ] **Step 6: Final independent review and fixes**

Generate one complete review package from the Phase 7 starting commit through HEAD. Dispatch a most-capable reviewer for correctness, privacy, concurrency, migration, two-stage compression, IPC boundary, UI state, and test gaps. Fix every Critical/Important finding with TDD and re-review until approved.

- [ ] **Step 7: Commit docs and acceptance state**

```powershell
git add docs/learning/phase-07-complete-memory-system.zh-CN.md docs/learning/00-overall-replica-roadmap.zh-CN.md README.md
git commit -m "docs: complete phase 7 memory system"
```

- [ ] **Step 8: Final clean verification**

```powershell
git status --short --branch
git log --oneline -15
```

Expected: clean local `main`; no automatic push.
