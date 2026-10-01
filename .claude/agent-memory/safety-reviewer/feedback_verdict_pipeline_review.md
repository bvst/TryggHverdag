---
name: verdict-pipeline-review
description: Checklist for reviewing evidence pipelines (spike judges, runners, go/no-go rules) where the risk is false confidence, not a production failure; found on SPIKE-01 (2026-09-30)
metadata:
  type: feedback
---

When the code under review turns device runs into verdicts (SPIKE-01 style: pure judges + untested glue
+ an unattended runner + a go/no-go rule), check:
- **Precedence of invalid over failed.** A judge that says `if (breaks) invalid; else if (gap) failed`
  lets *any* break anywhere erase a failure shown earlier with the harness intact; the runner then
  re-runs and a pass replaces it (D-060). Ask whether located breaks (tick holes, pmset sleeps) overlap
  the failure. Test names like "invalid when the harness broke *during* the gap" may be narrower than
  the code.
- **Exception scope in glue.** A secondary check (a capture read) inside the same try as the primary
  verdict turns a primary failure into "invalid" when the secondary throws. So does a runner that only
  judges runs whose driver exited 0.
- **Glue arguments vs test fixtures.** Tests may model inputs the production call never passes
  (SPIKE-01: tests gave the capture reader IPv4+IPv6 device addresses, judge.mjs passed IPv4 only, and
  the reader drops unknown sources silently). Diff the call site's literals against the test's.
- **Go/no-go input contracts coarser than the plan.** One boolean per platform (S7 `processEnded`) over
  several cases and runs lets one case's excuse cover another's failure: a false GO.
- **"No verdict" needs its own word.** If the rule accepts only passed/failed/not shown, a case stopped
  after invalid runs gets written as "not shown", which the rule treats as open: GO.
- **Drivers that wait-or-throw** convert a device failure (report never came, push never delivered)
  into invalid. Look for `waitFor` on the very thing the criterion judges.
- **Negative checks need a positive control** ("task gone from recents" is vacuous if the listing
  never shows the task).
- **Status words that mean "recorded"** (S6 "passed" once the record is read; S5 "passed" with heard
  not shown) must be split or reworded in the results, never shown as a bare pass.

**Why:** the spec's risk list (R1-R19) is all false confidence; a GO rests on these paths.
**How to apply:** any review of spikes/**, results documents, or go/no-go code. The fix for a live run
is post-hoc re-judging of saved run directories, never a re-run. Related: [[spike-01-night-20260930]],
[[spawned-process-test-review]].
