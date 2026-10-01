---
name: spike01-audit
description: SPIKE-01 spike tests (node --test, outside CI and Stryker) audited at 8a37a5e on 2026-10-01 — BLOCK for judge-run S3/S4 wiring untested; what a re-audit must re-check
metadata:
  type: project
---

SPIKE-01's spike (`spikes/background-safety/`) is not collected by Vitest, CI or Stryker. Its 247 `node --test`
tests are the only check on the go/no-go evidence. SPIKE is not a tracked prefix: tests are named `SPIKE-01-ACn:` by
practice, and a spike test must never name a tracked ID. Check this with `collectRequirements` plus `mentions` from
scripts/lib/requirements.mjs over `git ls-files spikes/`, not with a grep for prefixes.

Audit at 8a37a5e, 2026-10-01, during a live Android S1-exempt run. The verdict was **BLOCK**.
- Blocking: `analysis/judge-run.mjs` JUDGES.s3 and .s4 (deciding items) have no judgeRun test. The surviving mutants
  were inForce set to the constant HELD, breaks set to `[]` and exemption set to true. The code read correctly; the
  gap is in the tests.
- Should fix: the same gap for s2, s5-android breaks and s8 (processRunning, aligned16k). In manifest.mjs, two
  mutants survived: asRun taking an invalid S5 run's status from its details, and "S5 heard" passing with 1 valid run.
- Should fix (for safety-reviewer): `gapRule` excuses a >120 s gap if any timed break overlaps it. s1.test.mjs:320
  pins a gap with 145 s of silence while the ticks were intact as invalid.
- RG-03: every change to an existing test (6b61e92, 1de99a7, f5ec435) was judged stricter or equal. f5ec435's
  reasons existed only in a handoff for the PR body. tests:changes cannot see them, because every spike test file is
  new against main.
- The boundary tests, the refusal helper (9 refusal-removal mutants each killed by their own test) and the sentinel
  tolerance were all solid.

**Why:** the next audit of this branch is a re-audit after test-author adds tests.
**How to apply:** re-run `ta-spike-harness.mjs` with the same mutants (#2–#11, #39, #40 should now be killed).
Check that the PR body carries "Test changes" with reasons, and whether S1-exempt got its own go/no-go line (today
`per('s1')` pools its cases).
Related: [[entry-script-wiring]], [[in-memory-mutation]], [[gate-integrity-local]]
