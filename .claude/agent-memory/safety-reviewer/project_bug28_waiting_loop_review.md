---
name: bug28-waiting-loop-review
description: BUG-28 review 2026-10-18, PASS at cbf9896 (code 7a58b33): three L6 tests for watchdog openDue's waiting loop; planted 14 mutants; survivors break-after-skipped and break-after-failed
metadata:
  type: project
---

Reviewed claude/busy-faraday-40n2zl at cbf9896 (test commit 7a58b33), test-only, three `BUG-28:` tests in
apps/server/src/alerts.system.test.ts (held/let-go, let-go/held, both held). Production unchanged.

Verified myself (scratch vitest config spreading vitest.system.config.mjs + enforce:'pre' transform on
modules/alerts/watchdog.ts keyed on MUTANT; TMPDIR in scratchpad; `-t '^(?!.*BUG-28)'` = main's suite, 753 + 5
skipped where 2 skipped are expiry LOST-08-AC10 tests whose names mention BUG-28):
- L6 758/758 green. Killed only by the new tests: break after stuck, break after opened, waitFor.slice(0,1),
  reversed order, unconditional break, log only the first stuck, stuck count capped at 1, ok when stuck but
  something opened (the last also killed by one older test). failed-in-wait not stuck: killed by LOST-02-AC19.
- SURVIVE all 758: break after a waiting attempt answered `skipped` (holder alerted it / contact came), and break
  after a waiting attempt `failed`. break-after-skipped is the BUG-28 class (next journey loses its wait; sweep can
  beat once with a journey held; one sweep later, since the skipped journey leaves the read). break-after-failed:
  sweep still fails, only line/count lost. Reported as should-fix (fourth case), not blocking.
- The ~1094 "held by a session that never lets go" test's toEqual(beforeAt) cannot see a beat recorded on the
  failing sweep (same now); a beat-while-held-stuck mutant survives that test but is killed by "J held elsewhere"
  (clock advanced) and all three BUG-28 toBeNull tests. Note, not a safety gap.
- Test names prefix BUG-28 not LOST-02-AC20 (LOST-07-AC16 twins use the AC); precedent BUG-32/34/44; note.
Related: [[lost07-sms-review]], [[lost02-alert-review]], [[reviewer-sandbox-limits]].
