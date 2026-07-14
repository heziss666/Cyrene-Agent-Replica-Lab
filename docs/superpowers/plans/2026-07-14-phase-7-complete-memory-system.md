# Phase 7 Complete Memory System Execution Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute the linked plans in order. Do not start a later phase before the preceding phase's final verification and review gate pass.

**Goal:** Execute all remaining Phase 7 memory work from schema v2 governance through lifecycle maintenance, verified reflection, compression, and entity graph support.

**Starting Commit:** `3e71bd5` (`docs: design complete phase 7 memory system`)

**Approved Design:** `docs/superpowers/specs/2026-07-14-phase-7-complete-memory-system-design.md`

## Execution Order

### 1. Phase 7B: Governance and Automatic Resolver

Plan: `docs/superpowers/plans/2026-07-14-phase-7b-memory-governance.md`

Nine tasks:

1. schema-v2 types;
2. idempotent v1 migration;
3. reusable content policy;
4. governance and audit-safe CRUD;
5. typed IPC and Preload API;
6. Memory panel;
7. conflict detection and scoring;
8. automatic Resolver and applier;
9. runtime/UI integration and Phase 7B acceptance.

Gate before 7C:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

An independent reviewer must approve schema migration, CRUD privacy, IPC boundary, conflict scoring, auto-resolution, pinned protection, and deletion cascades.

### 2. Phase 7C: Lifecycle and Scheduler

Plan: `docs/superpowers/plans/2026-07-14-phase-7c-memory-lifecycle.md`

Six tasks:

1. recent-injection tracker;
2. pure lifecycle math and access reinforcement;
3. decay and L1 expiry;
4. Recall ranking and conflict context;
5. coalescing Scheduler and MaintenanceCoordinator;
6. IPC/UI/shutdown integration and Phase 7C acceptance.

Gate before 7D:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

An independent reviewer must approve decay idempotency, threshold boundaries, pinned behavior, Recall ranking, coalescing, and shutdown draining.

### 3. Phase 7D: Reflection, Compression, and Entity Graph

Plan: `docs/superpowers/plans/2026-07-14-phase-7d-memory-reflection-compression.md`

Eight tasks:

1. Reflection and verifier contracts;
2. verified profile promotion;
3. semantic clustering;
4. Compressor and verifier;
5. two-stage summary/vector commit;
6. rebuildable entity graph;
7. maintenance/UI integration;
8. Chinese guide, real acceptance, and final review.

Final gate:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:embedding
git diff --check
git status --short --branch
```

The final reviewer receives the complete diff from starting commit `3e71bd5` to final HEAD and must approve migration, privacy, concurrency, model-output validation, compression rollback, index consistency, IPC safety, UI state, documentation, and tests.

## Execution Rules

- Work directly on local `main`; do not create feature branches.
- Do not push to GitHub without an explicit user request.
- Use one fresh implementer subagent per task and an independent task reviewer after each task.
- Dispatch one combined fixer for all Critical/Important findings from a review wave.
- Record accepted Minor findings in `.superpowers/sdd/progress.md`.
- Never revert user changes or unrelated dirty files.
- Use `apply_patch` for manual edits.
- Every production behavior follows RED -> GREEN -> focused regression -> typecheck.
- Run the phase gate before moving to the next linked plan.
- Keep chat usable at every committed checkpoint.
- User-facing learning documentation is Chinese; internal execution reports may be English.
- Real acceptance uses fake personal facts and fake credentials only.

## Completion Definition

Phase 7 is complete only when all 23 tasks are committed, all three phase gates pass, real DeepSeek/Ollama/Electron/restart acceptance passes, the final reviewer has no Critical/Important findings, the worktree is clean, and the local `main` history contains the complete implementation without an automatic push.
