---
name: entry-script-wiring
description: In the house pattern (pure decisions in scripts/lib, entry script spawned as a process), the decisions are well tested but the entry script's use of them often is not; shape tests on the source let false-green mutants through
metadata:
  type: feedback
---

The repository keeps decisions pure in `scripts/lib/*.mjs` and tests them thoroughly. The entry script
(`scripts/*.mjs`) is tested as a real process for a few paths, and sometimes only by a "shape" test that greps its
source for a function call. Mutants in the entry script's use of a decision survive.

INF-06 (2026-09-26), all planted in the child and applied in every child, with a control mutant killed each time:
- `scripts/e2e-android.mjs`: `if (maestroRun.status !== 0 || !verdict.ok)` changed to `if (maestroRun.status !== 0)`
  survived all 11 tests. The shape test "judges the run by Maestro's report, through the tested decision" checks only
  that `judgeReport(` appears in the source. Result: a run in which Maestro exits 0 with zero or failed flows is
  green (the spec's R1). Graded Blocking. The process harness (`runPastPreflight`) that could test it already existed.
- `scripts/affected.mjs`: `app` forced to false on the pull_request path survived. The PR tests match only
  `app=(true|false)`. A push to main is the backstop, so graded Should fix.
- Dropping `expectOk` around checkLocale survived. The flow would still fail loudly, so graded Should fix.

**Why:** a decision that is tested but ignored by its caller is a false green, and false greens are the worst outcome
here. Unit-level coverage of the decision hides the gap.
**How to apply:** for each `if (!result.ok) stop(...)` or verdict combination in an entry script, plant a mutant that
drops it, and run the process tests. A shape test (a regex over the source) never counts as covering a verdict. When a
test says the full run "cannot be driven from here", check whether a later commit added a harness that can.
Outcome (re-audit at fa607f3): fb7ae01 added process runs where Maestro exits 0 and the report shows zero flows,
ERROR or CANCELED. The report-ignoring mutant and its variants (report rewritten to SUCCESS, message stripped of the
report) were all KILLED, and 14 of 14 children applied each mutant. The affected PR fixture kills app forced to
true or false. One remaining survivor, graded a Note: `touchesApp(changed, { root: '/nonexistent' })`. The fixture
has only `apps/*` and no workspace package the app depends on.
Deleting a test from a file that is **new on the branch** is invisible to `tests:changes`, which diffs against the
merge-base. So removing a superseded shape test before merge needs no RG-03 reason, but after merge it does.
**Dispatch tables get tested one entry at a time** (SPIKE-01, 2026-10-01, 8a37a5e). `analysis/judge-run.mjs` holds
`JUDGES = { s1, s2, …, s8 }`, moved into the analysis "so it is tested"; the M1 log says "every verdict rule now sits
in tested analysis". judge-run.test.mjs drives only s1, s5, s6 and s7. Mutating the argument wiring of the other
entries survived: s3 `inForce: meta.inForce` set to a constant HELD, s3 and s4 `breaks` set to `[]` (false passes on
deciding go/no-go items), and s8 `processRunning: true` / `aligned16k: true`. Controls in the same file (s1 and s7
breaks) were killed. Graded Blocking for the deciding items, Should fix for the findings-only ones.
How to apply: when a commit says logic "moved into tested X", list X's dispatch entries and grep the test for each
key (`metaOf('s3'`…), then mutate one argument per untested entry.
Related: [[bug-test-patterns]], [[in-memory-mutation]], [[baseline-vs-main]], [[spike01-audit]]
