# Phase 7B Task 2 Report

## Status

DONE_WITH_CONCERNS

The live memory runtime now uses schema v2. Cold load migrates valid schema-v1 files with a deterministic byte-for-byte backup and atomic replacement. Existing schema-v2 files are cloned without backup or rewrite. New L2 writes create a separate Evidence record and populate every required v2 lifecycle, sync, and linkage field.

## Scope

- Added pure and on-disk migration in `src/main/memory/memory-migrations.ts`.
- Switched public `MemoryFile` and `L2Memory` aliases to v2.
- Changed `MemoryStore` empty state, validation, cache, updates, and cold load to v2.
- Changed `MemoryManager` L2 persistence to create one linked Evidence record.
- Kept Recall result selection and user-visible behavior unchanged while typing its input as v2.
- Updated only the task-owned runtime and test fixtures, plus this requested report.

## TDD Record

RED command:

```powershell
npx.cmd vitest run tests/memory/memory-migrations.test.ts tests/memory/memory-store.test.ts
```

Observed RED: `memory-migrations.js` could not be loaded because the module did not exist. The pre-existing Store suite passed 12/12.

A later self-review identified duplicate migration transformation during Store cold load. A regression test was added first and failed because `idFactory` was called twice for one v1 L2. Store was then changed to classify private structural-validation errors without pre-running the transformer; the regression passed with exactly one ID allocation.

## Verification

- Focused migration and Store tests: PASS.
- All owned affected tests: PASS, 132/132.
- Full suite (`npm.cmd test`): PASS, 46 files and 380 tests.
- Production build (`npm.cmd run build`): PASS for Electron TypeScript and renderer Vite output.
- `git diff --check`: PASS; only Git's expected LF-to-CRLF working-copy warnings were printed.
- Typecheck (`npm.cmd run typecheck`): FAIL only in two unowned stale Task 1 tests.

Typecheck blockers:

- `tests/memory/memory-context.test.ts` still constructs embedded v1 `evidence` inside the now-v2 `MemoryRecallResult` L2 shape.
- `tests/memory/memory-types.test.ts` still explicitly asserts that `L2Memory` and `MemoryFile` equal their v1 aliases.

Those files were not changed because they are outside Task 2's owned-file list. Production-source type errors found during the first typecheck run were fixed; the repeat run reports only the three stale assertions above.

## Self-Review

### Atomicity and v1 preservation

Cold load runs recovery, reads original bytes once, parses JSON, validates v1, creates/verifies the pre-v2 backup, transforms and validates v2, then calls the existing atomic writer. Backup and replacement errors escape without corruption quarantine, so the original v1 primary remains readable. Invalid structures are still quarantined as corrupt files.

### Backup safety

The backup path is `memory.pre-v2-<now>.json`. Backup creation uses exclusive create. If the path already exists, migration reads and compares bytes: identical bytes allow retry; different bytes fail before touching `memory.json`. Original formatting and line endings are preserved byte-for-byte.

### Idempotence and evidence duplication

Existing v2 input returns a structural clone and performs no disk write or backup. A successful second disk call sees v2, so it neither creates another backup nor generates Evidence. Each v1 L2 allocates exactly one Evidence ID in iteration order, and each new Manager L2 allocates one memory ID plus one Evidence ID after deduplication succeeds.

### Alias and runtime consistency

`MemoryFile` aliases `MemoryFileV2`; `L2Memory` aliases `L2MemoryV2`. Store, Manager, Recall, IPC fixtures, and all task-owned tests now use v2. The retained v1 types and private v1 structural validator exist only for migration.

### Scope control

No Task 3+ content policy, governance, IPC API, UI, conflict resolution, lifecycle scheduler, or recall-ranking behavior was introduced.

## Concern

The repository-wide typecheck cannot pass without updating the two unowned stale tests listed above. The runtime test suite is fully green, and the remaining compiler diagnostics directly assert the superseded v1 public aliases.

## Concern Resolution

Status: DONE. This section supersedes the earlier `DONE_WITH_CONCERNS` status and concern after ownership was expanded to the two stale tests.

The existing RED checkpoint was `npm.cmd run typecheck`, which consistently reported exactly three errors:

- one embedded v1 `evidence` fixture error in `tests/memory/memory-context.test.ts`;
- two v1 public-alias equality errors in `tests/memory/memory-types.test.ts`.

The context fixture now constructs a complete `L2MemoryV2` with no casts or `any`. The type contract now proves `L2Memory` equals `L2MemoryV2` and `MemoryFile` equals `MemoryFileV2`, while concrete values using `L2MemoryV1` and `MemoryFileV1` prove the explicit migration types remain available.

GREEN evidence:

- `npx.cmd vitest run tests/memory/memory-context.test.ts tests/memory/memory-types.test.ts`: PASS, 2 files and 25 tests.
- `npm.cmd run typecheck`: PASS with exit code 0 and no diagnostics.
- `npx.cmd vitest run tests/memory/memory-types.test.ts tests/memory/memory-migrations.test.ts tests/memory/memory-store.test.ts tests/memory/memory-manager.test.ts tests/memory/memory-recall.test.ts tests/memory/memory-context.test.ts tests/main/register-chat-ipc.test.ts`: PASS, 7 files and 157 tests.

The previously reported Task 2 concern is fully resolved.

## Review Hardening Wave

Status: DONE. All Task 2 review findings marked `CHANGES REQUIRED` were fixed in one TDD wave.

### RED Evidence

After adding review regressions, this command failed as expected:

```powershell
npx.cmd vitest run tests/memory/memory-migrations.test.ts tests/memory/memory-store.test.ts
```

Observed RED: 4 failed and 29 passed. The failures proved that disk migration, Store load/cache/update, and Store validation dropped a benign v2 extension field, and that the requested exclusive-backup-write failure seam did not exist.

### Fixes

- Accepted v2 files are now fully structurally validated by Store and then returned as `structuredClone` copies of the original object, preserving benign extension fields consistently across pure migration, disk migration, Store cold load, cache, update, and persistence.
- The private v1 structural parser and authoritative v2 validator now live in `memory-store.ts`. `memory-migrations.ts` contains no permanent structural validators and was reduced from 524 lines to 106 lines.
- Store dynamically loads the disk migration coordinator only for schema v1, avoiding a static cycle while keeping v1 parsing private to Store.
- Disk migration validates/transforms v1 once per attempt; Store does not pre-run the parser or transformer.
- Added a minimal backup file-operations seam so tests can fail the actual exclusive `{ flag: "wx" }` write.
- Added a real `writeFileAtomically` failure test that moves the primary to `.bak`, fails replacement and rollback, then proves startup recovery restores readable byte-identical v1 data.
- Added a Store retry test proving failed migration does not initialize cache; retry creates no second pre-v2 backup and leaves exactly one Evidence record.
- Added representative fail-closed nested validation tests for L2, Evidence, ConflictLog, ReflectionLog, AuditLog, profile metadata, and maintenance.

### GREEN Evidence

- Focused migration/Store command: PASS, 2 files and 33 tests.
- Task 2 affected command: PASS, 7 files and 169 tests.
- `npm.cmd run typecheck`: PASS with exit code 0 and no diagnostics.
- `npm.cmd test`: PASS, 46 files and 392 tests.
- `git diff --check`: PASS; only expected LF-to-CRLF working-copy warnings were printed.

### Final Review

Atomicity, v1 readability, retry cache behavior, backup collision safety, v2 extension preservation, evidence idempotence, validation ownership, alias consistency, and Task 3+ scope exclusion were rechecked. No remaining concerns were found.

## Final Backup-Ordering Fix Wave

Status: DONE. Both remaining Important findings were resolved with a focused RED/GREEN cycle.

### RED Evidence

After adding the ordering and public-surface regressions, this command failed as expected:

```powershell
npm.cmd test -- --run tests/memory/memory-migrations.test.ts tests/memory/memory-store.test.ts
```

Observed RED: 3 failed and 32 passed out of 35 tests. The failures proved that `idFactory` ran before backup creation, a failed exclusive backup write still allocated an ID, and Store exported the obsolete `migrateMemoryFileForMigration` bridge.

### Fixes

- Disk migration now performs recovery, byte read and JSON parse, private v1 structural validation, exclusive byte-exact backup creation or verification, ID allocation and conversion, authoritative v2 validation, then atomic replacement in that order.
- The Store cold-load path uses the same private parsed-disk helper, so v1 is validated once and conversion is not duplicated.
- Backup failure exits before `idFactory`; retry and existing-byte verification retain the earlier no-second-backup and no-duplicate-Evidence guarantees.
- `memory-migrations.ts` is now a five-line, one-way facade over Store. It exposes only `migrateMemoryFile`, `migrateMemoryFileOnDisk`, and the erased options type.
- The exported `migrateMemoryFileForMigration` bridge and exported backup file-operations interface were removed. The failure seam is represented by a private structural type owned by Store.
- Store remains the owner of the private v1 parser, the authoritative v2 validator, and the migration implementation, eliminating the previous runtime cycle.

### GREEN Evidence

- Focused migration/Store command: PASS, 2 files and 35 tests.
- Task 2 affected command: PASS, 7 files and 171 tests.
- `npm.cmd run typecheck`: PASS with exit code 0 and no diagnostics.
- Full `npm.cmd test -- --run`: PASS, 46 files and 394 tests.
- `git diff --check`: PASS; only expected LF-to-CRLF working-copy warnings were printed.

### Final Review

The direct-disk and Store cold-load paths were traced for exact operation order. Public runtime exports, static import direction, v1 single-validation behavior, v2 clone preservation, backup idempotence, Evidence uniqueness, and Task 3+ scope exclusion were rechecked. No remaining concerns were found.
