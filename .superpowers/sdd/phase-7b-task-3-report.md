# Phase 7B Task 3 Report

## Status

DONE

## Scope

- Added dependency-free `memory-content-policy.ts` with shared normalization, model validation, and user-edited validation.
- Moved the existing sensitive-data, privacy, evidence-substring, scoped opt-in, negation, and statement-boundary policy into the reusable module.
- Added the exact normalized maximum of 2,000 characters. User edits allow medical/legal content as explicit opt-in while permanently rejecting secret, identity, and address patterns.
- Updated `MemoryManager` to delegate model-content validation and retain schema-v2 L2/Evidence persistence behavior.
- Added policy coverage and a manager regression for the length limit. No governance CRUD, IPC, UI, or model calls were added.

## TDD Record

RED command:

```powershell
npx.cmd vitest run tests/memory/memory-content-policy.test.ts
```

Observed RED: Vitest failed during collection because `src/main/memory/memory-content-policy.ts` did not yet exist.

## Verification

- Focused policy and manager tests: PASS, 2 files and 100 tests.
- Typecheck: PASS, `npm.cmd run typecheck`.
- Full suite: PASS, 47 files and 417 tests.
- Regex review: all policy regexes are non-global/non-sticky, so repeated validation is not stateful.
- Normalization review: content is NFKC-normalized, trimmed, whitespace-collapsed, then checked for blankness and the 2,000-character limit; meaningful Unicode remains preserved.
- Evidence review: model validation still requires an exact raw evidence substring and rejects unsupported or negation-changing transformations. New L2 writes still create one linked v2 Evidence record.
- `git diff --check`: PASS.

## Concerns

None.
