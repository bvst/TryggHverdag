---
name: stryker-incremental-reuse
description: With the command runner, Stryker's incremental report reuses old results for unchanged code, and any flaky test counts as a kill
metadata:
  type: reference
---

Found on INF-08 (2026-09-25).

- **The local incremental report is not a current measurement.** With
  `testRunner: 'command'`, Stryker's `incremental-differ.js`
  (`mutantCanBeReused`) returns true whenever `!testCoverage.hasCoverage`, and
  the command runner never reports coverage. Every mutant in unchanged code
  keeps its old status. Proven on INF-08: the report showed `worker.ts:208`
  (`name: 'worker'` → `''`) as Survived, while a hand mutant planted in memory
  is killed by "says the worker failed while stopping, and exits with 1".
  Never cite `reports/stryker-incremental.json` as current for code the branch
  did not change; plant a hand mutant to check. CI is fresh only because
  nothing caches `reports/` (gitignored, no cache step in `ci.yml`), so D-066's
  "`--incremental` in CI keeps that affordable" is wrong: the flag does nothing
  there. Follow-up recorded in `docs/progress.md`.
- **`killedBy` is always "All tests"** with the command runner, so a flaky test
  anywhere counts as a kill. INF-08: a mutant was "killed" only because a slow
  `bin.test.ts` test failed under Stryker's load. Load-test new timing-based
  tests (parallel runs plus CPU burners) before trusting a score.
- **Required checks without a token:** superseded. The repository went private
  on 2026-09-26, so anonymous `curl` returns 404. Use `gh api` instead; see
  [[gate-integrity-local]].
