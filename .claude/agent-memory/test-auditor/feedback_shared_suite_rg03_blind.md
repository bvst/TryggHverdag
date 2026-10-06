---
name: shared-suite-rg03-blind
description: tests:changes and the test-weakening hook key on TEST_GLOBS (*.test.*, mobile e2e), so shared behaviour suites like journey-store-behaviour.ts are invisible to both; read their diff by hand
metadata:
  type: feedback
---
LOST-03 loop 3 (2026-10-06): `pnpm run tests:changes --base <rev>` said "2 changed test file(s), none weakened" while the
real edits to existing tests (1b's rename, four `.rejects.toThrow()` -> `/refused/`) were in
`packages/test-kit/src/journey-store-behaviour.ts`, which holds every L2/L3 journey-store behaviour (alert/outbox included).
`scripts/lib/test-strength.mjs` TEST_GLOBS = `**/*.test.ts|tsx|mjs` + `apps/mobile/e2e/**`; `.claude/hooks/test-weakening.mjs`
uses the same list. guard-paths does cover test-kit (implementer denied `packages/test-kit/**`), so ownership is fine.

**Why:** a "none weakened" from the script is silent about non-*.test.* suites; the behaviour objects are `{name, run}`, not
`test(`, so even widening the glob would need test-strength to count `name:` entries.
**How to apply:** on any branch touching `packages/test-kit/src/*-behaviour.ts`, prove the edit scope mechanically: take HEAD,
remove the added entries and the declared renames/matcher changes, and compare byte-for-byte with the base. Raise the glob gap
as a repository should-fix (a BUG on main), not as a PR block.
Related: [[lost03-audit]], [[matcher-helper-changes]], [[safety-test-gate-gaps]]
