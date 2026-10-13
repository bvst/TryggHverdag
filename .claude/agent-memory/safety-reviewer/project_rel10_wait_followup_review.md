---
name: rel10-wait-followup-review
description: REL-10 follow-up (CANARY_WAIT exported, worker.ts slot/shutdown comments, four AC9 real-timer tests) — PASS c80fbea; should-fix: test 1's 10 ms ordering margin
metadata:
  type: project
---

PASS at c80fbea (2026-10-10), branch claude/busy-faraday-40n2zl (tests 7158b42, code c80fbea).

Verified:
- Both worker.ts comments (around lines 431-440) are true of run.ts, healthchecks.ts and Graphile 0.18. The run limit is 600 s;
  the halted path races home against a 5 s wait whose own controller the stop never aborts; reportFor('INTERRUPTED') is
  null; the report gets the stop signal; the check-in and alarm use the default CHECK_IN_TIMEOUT_MS (worker.ts:611-616).
  Graphile's gracefulShutdown awaits worker.release() (main.js ~570), and the abort timer is setTimeout(abort, 0) unref'd
  (~663), so a stop waits for the job.
- Export: only bin/worker.ts imports worker.ts; modules importing it would be a cycle (no-circular).
- Real node:timers/promises (Node 22.22.2): a pre-aborted signal sets no timer; abort clears the timer synchronously;
  the `{}` mutant keeps it. process.getActiveResourcesInfo() 'Timeout' count = refed timers.
- 5x the four tests at load 8.8-10.8 plus the whole file 190/190: all passed.

Should-fix (left open): the first test (worker.test.ts:4825-4829) starts its 90 ms bound AFTER the 100 ms wait. Node stamps
each timer with the real time it was created (a 30 ms busy gap made wait100 fire before bound90), so a gap over 10 ms
(GC, preemption on a loaded runner) is a false red, and the comment at :4758 ("how long the machine takes changes
nothing") is false for that test. Fix: start the bound before CANARY_WAIT, or widen the margin. A false red, never a
false green.

General lesson: "a bound started after X and due before X" holds only if the gap between the two creations is smaller
than the difference in delays. Check every real-timer ordering claim for that margin.
