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
- **Cases that never ran.** A per-case "two valid runs" rule built from the cases *present* lets a
  missing case vanish: the item passes on the rest. Emulate by dropping a case's lines from the real
  manifest and calling the input builder (SPIKE-01 loop 1: S7 Android read "passed" without "fine").
- **Untimed breaks after a timed-break fix.** Check which breaks still carry no time (device death
  checked only at the end, route-step failures) and whether they still erase an earlier shown failure.
- **"A lookup" may be a connection.** Read the SNI on saved pcaps (`tcpdump -A -r ... 'src port N'`)
  and sum bytes per flow before accepting "only a DNS lookup". APK config checks need a positive
  control (`unzip -p x.apk resources.arsc | tr -c '[:print:]' '\n' | grep app_name`).
- **"Open until L9" is a term of art.** In goNoGo it means not shown, which never blocks GO; a failed
  item described as "open for L9" in prose can drift into that list. Keep failed items out of it.

- **Interval arithmetic across two clocks.** Cutting a wall-clock span (a Mac sleep) out of a gap measured
  on a monotonic clock (performance.now(), which on macOS likely stops in sleep) overshoots by the sleep's
  length and erases real post-sleep silence. Test fixtures that advance mono and wall together hide it.
- **Several manifests at once.** Concatenated inputs need duplicate-runId refusal (one run counted twice
  turns "no verdict" into a pass) and a refusal of runs whose case the plan does not know (their
  failures silently leave the go/no-go while the per-scenario printout still shows them).
- **"Condition" vs "resolved" vs "fixed".** A setting that makes an item pass is a condition of a GO;
  check prose (results, progress log) and the GO headline say so, and quote the vendor's own caveats.
- **"The cause" in results.** A plausible platform mechanism (an AOSP flag) is a likely cause until its
  state on the image is read and a run with the fix passes; "not a platform limit" needs that run.

**Why:** the spec's risk list (R1-R19) is all false confidence; a GO rests on these paths.
**How to apply:** any review of spikes/**, results documents, or go/no-go code. The fix for a live run
is post-hoc re-judging of saved run directories, never a re-run. Related: [[spike-01-night-20260930]],
[[spawned-process-test-review]].
