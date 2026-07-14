# Phase 7B Task 4 Report

## Status

DONE

## Implemented

- Added `MemoryGovernanceService` with renderer-safe snapshots and user-governed profile/L2 update, delete, pin, enable, restore, and clear operations.
- Added structural memory auditing for missing Evidence, broken resolution links, conflict markers without live logs, and summaries with missing sources.
- Corrected the shared governance contracts to expose `MemoryMutationResult`, exact update/pin/enable inputs, and privacy-safe structural audit findings.
- Reused the existing serialized `MemoryStore.update()` transaction. No store implementation change was required.

## TDD Evidence

Initial RED:

```text
npx.cmd vitest run tests/memory/memory-governance.test.ts tests/memory/memory-audit.test.ts
FAIL: memory-governance.js and memory-audit.js did not exist
```

Additional audit RED found during self-review:

```text
npx.cmd vitest run tests/memory/memory-audit.test.ts
FAIL: a memory with no evidence IDs returned no findings
```

Both failures were observed before their production implementations.

## Verification

```text
npx.cmd vitest run tests/memory/memory-governance.test.ts tests/memory/memory-audit.test.ts tests/memory/memory-store.test.ts
PASS: 3 files, 44 tests

npm.cmd run typecheck
PASS

npm.cmd test
PASS: 49 files, 459 tests

git diff --check
PASS
```

## Self-Review

- Transaction atomicity: every successful mutation calls `store.update()` exactly once. Cheap shape/content validation failures do not enter a transaction; no-op and missing-state operations enter `store.update()` and reject transactionally after authoritative checks on the serialized draft, before persistence or audit append.
- Content policy: all user-edited strings, including each profile-array item, pass through `validateUserEditedMemoryContent()` before a transaction starts.
- Cascades: L2 deletion removes owned Evidence and live references, invalidates executable conflict history, removes source references, and disables affected summaries with `sync_failed`. L2 clear removes all L2/Evidence and invalidates executable conflict history without adding content.
- Pinning: pin sets `isPinned` and `weight = 1`; explicit governance remains available for pinned memories. Future automatic services can enforce protection from the persisted `isPinned` state.
- Audit safety: success logging is centralized, appends exactly one metadata-only entry, and trims with `slice(-500)`. Invalid/no-op/missing/stale operations append no success entry.
- Snapshot privacy: Evidence quotes, Evidence IDs, source snapshots, conflict signals, and `resolutionReason` are not present in renderer DTOs.
- Error typing: mutation failures use only `not_found`, `invalid_state`, or `invalid_content` with fixed safe messages.

## Concerns

None. IPC, UI, conflict detection/resolution, lifecycle, and scheduling remain intentionally out of scope.

## Review Hardening

Status: DONE

### RED Evidence

```text
npx.cmd vitest run tests/memory/memory-governance.test.ts tests/memory/memory-audit.test.ts
FAIL: 9 tests
- queued enable, pin, edit, and clear observed stale pre-transaction state
- empty L2 did not clean orphan Evidence or executable conflict logs
- sourceSnapshots were not filtered or audited independently
- Store write errors escaped with private path/content

npm.cmd run typecheck
FAIL: all 6 legacy mutation result aliases differed from MemoryMutationResult
```

### GREEN Evidence

```text
npx.cmd vitest run tests/memory/memory-governance.test.ts tests/memory/memory-audit.test.ts tests/memory/memory-store.test.ts
PASS: 3 files, 54 tests

npm.cmd run typecheck
PASS

npm.cmd test
PASS: 49 files, 469 tests
```

### Review Resolution

- Linearizability: mutation methods perform only shape/content validation before `store.update()`. Existence, no-op, restorable-state, and layer-cleanup decisions now run on the serialized draft. A focused private L2 mutation helper centralizes lookup, timestamp, audit metadata, and error handling.
- Clear L2: orphan Evidence, reflection source references, and every queued/processing/uncertain conflict log are cleaned even with no live L2 rows. Resolved/failed logs remain content-free history.
- Shared contracts: profile update, L2 update, delete, pin, enable, and clear result aliases all resolve to `MemoryMutationResult`.
- Source snapshot integrity: deletion filters source IDs and snapshots independently, disables drifted summaries whose snapshot source disappears, and audit reports missing snapshot targets plus set mismatches.
- Store failures: initialization/update/validation/write rejection through the transaction boundary resolves to fixed `invalid_state` metadata. Store messages and causes are never included, and rejected writes do not commit Evidence or audit entries.

### Review Concerns

None.

## Second Fix Wave

Status: DONE

### RED Evidence

```text
npx.cmd vitest run tests/memory/memory-governance.test.ts tests/memory/memory-audit.test.ts
FAIL: 4 tests
- edit retained a drifted Evidence reference owned by the edited memory
- delete retained a drifted Evidence reference owned by the deleted memory
- snapshot mapping failure occurred after persistence instead of aborting the update
- snapshot/audit reads exposed the Store load error

npm.cmd run typecheck
FAIL: snapshotBuilder was not an accepted narrow governance-service option
```

### GREEN Evidence

```text
npx.cmd vitest run tests/memory/memory-governance.test.ts tests/memory/memory-audit.test.ts tests/memory/memory-store.test.ts
PASS: 3 files, 58 tests

npm.cmd run typecheck
PASS

npm.cmd test
PASS: 49 files, 473 tests
```

### Resolution

- Commit/result consistency: each successful renderer snapshot is built inside the Store mutator after the mutation and audit append. Snapshot conversion failure aborts the update, and the captured DTO is returned without post-commit mapping.
- Read privacy: `snapshot()` and `audit()` replace Store load or mapping rejection with a new fixed `Memory data could not be loaded` error and do not retain the underlying cause.
- Evidence ownership drift: edit and delete remove the union of declared Evidence IDs and every Evidence row owned by the target, then remove that full union from all surviving L2 references.
- Transaction documentation: no-op and missing-state checks are documented as serialized transactional rejections; only cheap shape/content validation stays outside `store.update()`.

### Concerns

None.
