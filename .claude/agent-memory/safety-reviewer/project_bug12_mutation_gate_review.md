---
name: bug12-mutation-gate-review
description: BUG-12 / D-098 review 2026-10-02 (PASS at 7f6c3a7, tree = f365b70) — per-file kill-only judge, Vitest 20 s + --bail=1 inside timeoutMS 35 s, process/api-process groups, fake PostgreSQL; four open should-fixes
metadata:
  type: project
---

Reviewed fbc6ed7..7f6c3a7 (branch then merged origin/main as 7b79476, tree-identical, + docs f365b70). PASS.

Verified (scratch copy via `cp -a` of the repo, 34 s; git works in the copy):
- Fresh `pnpm run mutation` on 4 cores: 302 s, 265 mutants, 0 timed out, every file >= 80 %: domain 108/108,
  healthchecks 44/44, journeys 19+2 surv, process.ts 25/25, bin/worker.ts 4/4, worker.ts 53+2 surv, api-process 8/8.
- No kill relies on Vitest's 20 s timeout: every process.ts kill is an assertion within 2-5 s, because --bail=1
  stops Vitest at the first fast in-process failure before bin.test.ts's slow waits. A planted hang in
  api-process stop(): Vitest fails at 20 s, 24.9-25.8 s wall with 4 at once, vs Stryker's ~38.7 s.
- Survivors: worker.ts:197 `name:'worker'` on the build branch is equivalent (name printed only when stop
  rejects; that stop is Promise.resolve()); worker.ts:194 is the log tail "the machine that runs the app starts
  its own" — no test anywhere asserts it; service.ts:42 equivalent (transition ignores event.type);
  service.ts:62 equivalent at api.ts:82 (`=== 'started'` only).
- Unset STRYKER_RUN: Stryker exits 1 with the D-098 message.

Open should-fixes (check before repeating):
1. `--incremental` + command runner = every unchanged-code mutant reused whatever the tests did
   (incremental-differ.js mutantCanBeReused: `!testCoverage.hasCoverage` -> true). Shown: api-process.test.ts cut to
   one empty test, `--incremental` -> "8 of 8 mutant result(s) are reused", 100 %, ok=true; fresh -> 0 %, fails.
   CI unaffected today (reports/ gitignored, no cache step); gate.mjs (gate:full) and ci.yml still pass it.
2. A listed safety *file* that vanished (rename) leaves the group running on the rest: Stryker only warns
   "Glob pattern ... did not result in any files", report lacks it, gate says "every run passed (process)";
   all 271 scripts tests stay green. Fix: unit test that every file-type SAFETY_PATH exists and folders end in '/'
   (hasSourceFiles answers false for a slash-less folder), or the judge requires each listed file in the report.
3. judgeMutationReport LEFT_OUT drops RuntimeError/CompileError/Ignored from the denominator and does not name
   them: "1 killed + 9 RuntimeError" prints 100 %. With the command runner a RuntimeError is a runner that never
   ran the tests (exec 'error' or RetryRejectedDecorator after crashes), not a mutant that breaks the code.
4. api-process.test.ts proves the health route's clock is the database's (2031 answer), but the journey test
   stops at the first journey read, so a second clock wired into createJourneyService passes every test;
   the L3 journeys test builds its own realApi() instead of calling startApiProcess.

**How to apply:** on LOST-01/LOST-02 or any mutation-config PR, check these four; the trigger gap from BUG-10
(config-only changes skipped mutation) is CLOSED by D-098 (verified by emulating decideMutation).
