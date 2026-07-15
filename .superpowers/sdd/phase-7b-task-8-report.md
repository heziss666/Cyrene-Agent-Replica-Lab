# Phase 7B Task 8 Report

## P1 Hardening

- `preference_evolution` now accepts only `supersede_target`; it can supersede only a strictly older, unpinned target. The parser rejects an unsafe action, tied timestamps, and a source that is not newer.
- The deterministic applier independently checks the same age and pin conditions. Tied, reversed, or pinned preference cases resolve the log as `uncertain` and leave both memories active.
- Applier snapshots now compare content, created and updated timestamps, evidence IDs, pin and enabled state, lifecycle status, weight, conflict linkage, and supersession/merge linkage before changing memory state.
- A changed pin or enabled state after resolver payload creation is stale and does not overwrite the user action. Keep-both resolutions only clear the conflict pair; they do not re-enable or otherwise alter either memory's lifecycle state.

## TDD Evidence

Initial RED:

```text
npx.cmd vitest run tests/memory/memory-resolver.test.ts tests/memory/memory-resolution-applier.test.ts
FAIL: 15 regression assertions exposed unsafe preference actions/ages, incomplete stale fingerprints, and keep-both re-enabling a disabled memory.
```

The regression coverage includes parser action and age validation; applier tie, reversed-age, and pinned-target downgrades; disabled-memory preservation; content, evidence, status, weight, and linkage races; and explicit pin/disable races.

## Verification

```text
npx.cmd vitest run tests/memory/memory-resolver.test.ts tests/memory/memory-resolution-applier.test.ts tests/memory/memory-resolver-queue.test.ts
PASS: 3 files, 37 tests

npm.cmd run typecheck
PASS

npm.cmd test
PASS: 58 files, 573 tests
```

## Scope

This hardens Task 8's resolver and deterministic applier only. Task 9 runtime integration remains unchanged.
