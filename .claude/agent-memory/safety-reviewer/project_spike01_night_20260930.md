---
name: spike-01-night-20260930
description: SPIKE-01 overnight counted runs (night-20260930, harness e9753cc, builds 20545d9) were reviewed BLOCK on 2026-09-30; what to check when the results document / go-no-go reaches review
metadata:
  type: project
---

Reviewed `feat/SPIKE-01-background-safety` at e9753cc while the overnight runner ran (started 20:09
CEST 2026-09-30, ~11 h). Verdict BLOCK, for fixes to land *before* the results and go/no-go are
written, with no re-run needed (all raw evidence is in ~/spike-runs/<runId>/):
- go-no-go.mjs: S7 `processEnded` is one boolean per platform, but Android S7 has two cases
  (background, fine); processEnded is only in driver.jsonl, not meta.json or the manifest.
- D-060 paths: s1.mjs/s3.mjs let any break override a shown gap; judge.mjs's S1 capture read can throw
  and wipe S1's verdict; run-all.mjs judges nothing when a driver exits non-zero.
- No representation for "no verdict" (case stopped after 3 invalid runs) in goNoGo/renderResults.
Should-fix: judge.mjs passes only 10.0.2.15 to the capture reader (tests use fec0::15 too); S3
not-exempt driver waits-or-throws on the very report AC7 judges; S5 iOS "presented" checks only the
foreground push. The dry run showed the Android alert record going out as USAGE_NOTIFICATION.

**Why:** the owner's SDK go/no-go (D-023, $399) rests on these results.
**How to apply:** when reviewing 04b-spike-results.md or a follow-up to spikes/background-safety,
check each item above was fixed or explicitly handled, and that the results split S5 seen/heard and
state S6 as observed behaviour. See [[verdict-pipeline-review]].
