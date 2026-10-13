---
name: bug45-mutation-fanout-review
description: BUG-45 / D-129 / D-130 review 2026-10-13 (PASS at 1800135, code 89688b1) — mutation check split into mutation-plan, a matrix mutation-group, and the aggregator `mutation` (if: always()); turnBound in test-kit; two Stryker disable BlockStatement exclusions in run.ts
metadata:
  type: project
---

Reviewed origin/main...1800135 (red 0481b8a, fix 89688b1, D-130 docs 1800135). PASS.

Verified:
- run.ts while condition rewrite is exact: Date ms are integers below 2^53, NaN exits both forms.
- Stryker 10 `disable next-line` matches mutants whose start line == the start line of the node carrying the
  leading comment (directive-bookkeeper.js + babel-transformer.js:188), filtered by mutator name. So the
  BlockStatement directive above `while (...) {` / `for (;;) {` covers only that body block.
  Ranged run STRYKER_RUN=canary --mutate run.ts:186-252: 86 instrumented, 84 killed, 0 survived, 0 timeout
  (= 2 ignored). Ranged worker.ts:257-296: 26 killed, 0 timeout, survivors 260:17 and 284:11 = baseline.
- Baseline reports at <scratchpad>/bug45-timeouts/{canary,worker}.json (9dab041).
- Aggregator emulated (node -e importing aggregateMutationJobs): only passes on plan success + (skip & legs
  skipped & groups == derived) or (run & legs success & every report re-judged). undefined/'' results fail.
- affected.mjs exits 1 on an unresolvable base; changedFiles then returns only uncommitted files (would skip):
  the plan depends on affected running first in the same job (pinned by gate.test).
- canary.system (112) and worker.test (192) green at load 14 with the bounds; afterEach asserts bound.passed
  empty, so a bound trip is a red, never a mask.
- download-artifact 37930b1 = v7.0.0, upload 043fb46 = v7.0.1 (git ls-remote). gh api to the repo is 403 now.

Open notes (check before repeating):
1. AC13 (the shape on GitHub, re-run reads first attempt's artifacts) not verified: no PR/CI yet.
2. Aggregator does not check a report's files are the group's files (BUG-12 note 2 still open).
3. Aggregator trusts the plan's `skip` (shallow checkout, cannot re-derive) — same trust as the old job.
4. if: always() aggregator runs on a cancelled run and goes red on the superseded SHA (benign).

**How to apply:** on any later mutation-CI change, re-run the emulation table and the directive line check.
Related: [[mutation-gate-checks]], [[bug12-mutation-gate-review]], [[bug29-worker-group-review]].
