---
name: spike01-audit
description: SPIKE-01 spike tests (node --test, outside CI and Stryker): BLOCK at 8a37a5e (judge-run S3/S4 untested), PASS at 6ae585f after loop 2; open should-fixes and what a further audit must re-check
metadata:
  type: project
---

SPIKE-01's spike (`spikes/background-safety/`) is not collected by Vitest, CI or Stryker. Its `node --test` suite
(312 tests at 6ae585f, of which 298 are under analysis/) is the only check on the go/no-go evidence. SPIKE is not a
tracked prefix: tests are named `SPIKE-01-ACn:` by practice, and a spike test must never name a tracked ID. Check
this with `collectRequirements` plus `mentions` (scratchpad `ta-tracked-ids.mjs`), not with a grep for prefixes.
`drivers/lib/android.mjs` and `ios.mjs` mention PRIV-07. They are not test files, so they count for nothing.

**Audit at 8a37a5e (2026-10-01): BLOCK.** `judgeRun`'s JUDGES.s3 and .s4 were untested: mutants forcing inForce to
HELD or dropping breaks survived. Should-fixes: the s2/s5/s8 wiring, manifest #39/#40, and `gapRule`'s overlap
excusing a gap.

**Re-audit at 6ae585f (2026-10-01, loop 2): PASS.** 132 in-memory mutants: 99 killed, 33 survived, all applied, and
the no-op control survived. B1 (#02–#05), #06–#11, #39 and #40 are all killed now, and the intact-stretch rule is
pinned (J11/J13/J14/J15/J15b killed). RG-03 holds: the s1 tests moved invalid→failed, the refusal helpers gained
RangeError, and input() now passes the plan. The reasons are in the 299877a and 27adb62 commit messages.
Open should-fixes. All lean toward false failure or touch only non-deciding items, except the first two:
- `goNoGoInput` silently drops a **failed** judged run whose case is not in `expected`, so S4 or S7 reads "passed".
  It is latent: no recorded run lies outside `expectedCases()`. `drivers/lib/plan.mjs` `expectedCases` is untested,
  and NIGHT_PLAN in manifest.test.mjs is a hand copy of it.
- `breakOver`'s strict `<`/`>` is pinned only by an S1 test, where it is inert (`longestIntact` drops empty cuts). The
  touching boundary in failureRule (S7, S2, S3 not exempt) and S4's `over` is unpinned (J1/J1b/J1c).
- `longestIntact`'s sort (J10) and its `Math.max(at, end)` (J12, a sleep nested in a tick hole, the realistic
  shape) are unpinned. S4's orderFinal clock choice, untimed term and `>` are unpinned (S4b/c/d).
- withBreaks: S5 iOS changed text beside a break (W10), and S5 failures beside an untimed break (W3/W8/W12).
- #35 (Force stop counted) was killed at 8a37a5e and survives now: the plan filter shadows `judged !== false`.
- The Firebase regex's multi-label part (C1) and its anchors (C2/C3) are unpinned.

**How to apply:** a further audit re-runs `ta-spike-harness2.mjs ta-spike-mutants2.mjs` (scratchpad of session
1f3a0f86…). The ids above should then be killed. No PR existed at 6ae585f. When one opens, check that its body
carries the "Test changes (RG-03)" sections of 6b61e92, 1de99a7, f5ec435, 299877a and 27adb62. tests:changes
cannot see them, because every spike test file is new against main.
Related: [[entry-script-wiring]], [[in-memory-mutation]], [[gate-integrity-local]], [[shadowed-guards]]
