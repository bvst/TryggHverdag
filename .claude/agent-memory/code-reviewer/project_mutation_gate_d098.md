---
name: mutation-gate-d098
description: BUG-12 / D-098 review (2026-10-02) — the per-run JSON report gate, Stryker 10 and pg 8 facts verified from source, how to audit kills, open gaps
metadata:
  type: project
---

Since D-098 (BUG-12) every Stryker run writes `reports/mutation/RUN.json` and `scripts/mutation.mjs` judges it file by file: only Killed counts, and each file needs 80 % of killed / (killed + survived + timeout + no coverage). An unset `STRYKER_RUN` throws in stryker.config.mjs. The groups are domain, healthchecks, journeys, process and api-process. The whole-suite run holds only placeholder paths (modules/alerts/, safety-core/) and is skipped while they hold no .ts file.

Verified by reading node_modules source (Stryker 10.0.0, pg 8.23.0):
- Stryker exits 0 for a run with zero mutants. The score is NaN, and `NaN < break` is false (mutation-test-report-helper.js, determineExitCode). Any comment saying "Stryker would fail" on an empty run is wrong; the gate's own judge is what fails it.
- The per-mutant timeout is timeoutFactor * netTime + timeoutMS + overhead (mutant-test-planner.js). The repo sets timeoutMS to 35 s, and Vitest's --testTimeout and --hookTimeout to 20 s, with --bail=1.
- pg sends Close only when bind throws (query.js prepare) and Flush only when `rows` is set (cursors). It always sends Describe(P) before Execute. In test-kit's fake PostgreSQL, a branch for anything else is a guess.

How to audit kills: `statusReason` in the JSON report holds the Vitest output. A python heredoc that groups kills by their `FAIL <file>` line and by "timed out in" did the job. In the 2026-10-02 process run, all 9 bin.test.ts kills were on-point assertions (exit codes, messages), with no false kills from timing. `worker.ts` and `bin/worker.ts` share a basename, so group by the full path.

Open gaps, raised as Notes (not blocks) in the BUG-12 review:
- The run is triggered by safety paths, group tests and configs, test-kit and the gate's own files. It is not triggered by what the tests import (api.ts, http.ts, adapters, packages/contracts). So a non-safety PR can lower a safety file's kill ratio without the gate running.
- The whole-suite run is unreachable while the unit test "no safety file falls to the whole-suite run" is green. Deleting it needs the owner, because D-066's amendment defines it.
- A reviewer who runs `STRYKER_RUN=x pnpm exec stryker run` by hand now overwrites `reports/mutation/x.json`, which is the gate's input. The safety-reviewer memory still says such runs write no reports/ file.

Process facts:
- The caller merged origin/main into the branch while the review was running, and HEAD moved twice. Before the handback, run `git log -3` again and say which commit was reviewed.
- The guard blocks any Bash command whose text holds the Node env-object accessor (process, dot, env), even inside a heredoc of prose, as a ".env read". Use the Grep tool for code searches, and spell it out in prose.

Related: [[spec-promises-vs-head]], [[ids-taken-while-open]], [[spawned-process-tests]].
