---
name: narrowed-mutation-group
description: When a decision narrows the tests a mutation group runs (to save CI time), how to judge "it cannot hide a weak test" - per-mutant report diff, the timeout exception, and where the old report went
metadata:
  type: feedback
---
BUG-29 / D-117 (2026-10-07) moved worker.ts out of the process group so its mutants no longer run bin.test.ts.
**Why it can't inflate a score:** with the command runner a mutant is Killed iff some test in the set fails before
Stryker's timeout, so dropping tests can only turn Killed into Survived/Timeout. The one way up is Timeout -> Killed
(the dropped test hung, a kept test failed fast), which is still a real failure of a kept test. Fewer tests also mean
fewer flaky kills (killedBy is always "All tests"). Under-crediting a dropped test is loud (survivors named), never a
false green.
**How to apply:** ask for the per-mutant comparison, then check it: key mutants by
`mutatorName@start-end|replacement` and diff the narrowed report against a with-dropped-test report. reports/mutation/<run>.json
is overwritten by the next run of that name, so look for the older run's log or JSON in the scratchpad. Also check that the
narrowed run still writes its own report name, sits in exactly one run, and that every per-run property test iterates
mutationRuns() so the new group inherits them (it did).
Related: [[bug29-audit]], [[stryker-incremental-reuse]], [[mutation-pooled-score]]
