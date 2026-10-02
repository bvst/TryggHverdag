---
name: mutation-gate-checks
description: How to test a mutation gate for silent passes — emulate the real judge with synthetic reports, run one group through the real runMutationGroups in a scratch copy, and the Stryker 10 facts that matter (command runner has no coverage; incremental reuses everything)
metadata:
  type: feedback
---

Checklist that found real holes on BUG-12 (2026-10-02):
- Feed synthetic reports through the real `judgeMutationReport` with every status (Killed, Survived, Timeout,
  NoCoverage, RuntimeError, CompileError, Ignored, Pending, wrong case, empty files). Look for statuses that
  leave the denominator *and* the printed line.
- Drive one group through the real `runMutationGroups` + `strykerRunner` from a small script in the scratch
  copy (filter `mutationRuns()` by name), so clearReport/readReport/hasSourceFiles are the real ones.
- Try: a renamed safety file (git mv + fix the test that spawns it, leave SAFETY_PATHS stale); a gutted group
  test with and without `--incremental`; a slash-less folder in hasSourceFiles.
- Stryker 10 command runner: reports one "All tests" test and no coverage, so `hasCoverage` is false and
  `mutantCanBeReused` returns true for every mutant in unchanged code — test edits never invalidate reuse.
  A non-zero exit, including a signal death (code null), is Killed; exec 'error' is RuntimeError.
- Per-mutant timeout = timeoutFactor (1.5) x dry-run net + timeoutMS + overhead (mutant-test-planner.js).
  A timed-out test still runs afterEach, so the worst case is testTimeout + hookTimeout, not the max.
- Kills caused by a Vitest timeout are visible only in statusReason ("Test timed out in 20000ms"); count them
  to see whether a loaded run inflated kills.

**Why:** BUG-12's failure was a pass that measured nothing; each of the above is another way to get one.
**How to apply:** any PR touching gate-decisions.mjs, mutation.mjs, stryker.config.mjs or the groups' tests.
Related: [[bug12-mutation-gate-review]], [[reviewer-sandbox-limits]].

**Vitest drops a named test file its config excludes, silently (2026-10-02, BUG-14).** Stryker's command names
each group's tests, but `vitest list --filesOnly --exclude 'apps/server/src/bin/**' <bin.test.ts> <others>` lists
only the others, exit 0, no warning. So the root Vitest config (include in vitest.shared.mjs, exclude in
vitest.config.mjs) decides a group's real test set. CLI --exclude is a file-free way to emulate a config change.
