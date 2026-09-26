---
name: safety-test-gate-gaps
description: A change that edits only a test guarding safety code skips both CI's mutation gate and CI's safety-reviewer; test-auditor is the only CI reviewer left
metadata:
  type: project
---

As of main f004300 (2026-09-26):
- `decideMutation` (scripts/lib/gate-decisions.mjs) matches changed files by `startsWith` against SAFETY_PATHS.
  `apps/server/src/bin/bin.test.ts` and `apps/server/src/worker.test.ts` match nothing, so a test-only edit prints
  "touches no safety code". This was confirmed by calling decideMutation on BUG-5's changed files.
- ai-review.yml's `safety` paths filter lists the same source files and no tests, so CI's safety-reviewer also
  prints "nothing to look at" for such a change. test-auditor (`applies: always`) is the only reviewer that runs.
- D-036's nightly full mutation run did not exist yet.

**Why:** a weakened safety test would pass every CI gate except RG-03's `tests:changes` and this audit.
**How to apply:** on test-only changes to tests that guard SAFETY_PATHS, compare the strength of the old and new
tests yourself: the assertions, the timing windows, and which mutants each kills. Before repeating the finding,
check whether gate-decisions.mjs, the ai-review filter or a nightly workflow has closed the gap. Both fixes belong on
main.
Still open at main 1c0b575 (2026-09-26, BUG-5 re-audit): SAFETY_PATHS and the ai-review filter are unchanged. There is
still no nightly mutation workflow; `daily-status.yml`'s cron is the report and does not mutate. The loader technique in
[[in-memory-mutation]] lets this audit plant mutants in the child process itself, so use it for bin.test.ts.
Also: main's ai-review.yml now grants the review job `checks: read`, so in CI RG-05's mutation result may be
readable. The brief's "you very likely cannot read it" may be stale.
Related: [[stale-base]]
