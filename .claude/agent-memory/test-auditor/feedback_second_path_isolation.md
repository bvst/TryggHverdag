---
name: second-path-isolation
description: In retry/second-attempt loops and per-item loops, tests cover the first path and the happy isolation case; mutate the second loop's outcome mapping and add a break after a per-item failure
metadata:
  type: feedback
---

LOST-02 (2026-10-04): the watchdog's first-attempt failure, held-row stuck case and held-row isolation were all tested, and Stryker
scored 97 %. Two semantic faults Stryker cannot generate survived every level: the second (waiting) attempt's `failed` outcome
mapped to not-stuck, and a `break` after one journey's failed open. Both broke clauses written in the spec's approach ("in either
attempt", "one journey's failure holds up no other").

**Why:** Stryker mutates operators and literals, not "narrow the set of outcomes that count" or "stop the loop early"; a safety
claim phrased as "either"/"every"/"no other" needs a test per path and a two-item test, and nothing else will notice.
**How to apply:** for any loop over items with a failure branch, plant `break` after the failure and check a later item still
succeeds. For any retry/second-attempt, plant `!== 'ok'` -> `=== '<one bad outcome>'` in the second loop. Grep the spec for
"either", "in each", "no other", "holds up" and map each to a test. Prove the fix cheaply by appending a probe test in memory.
Also: a shared behaviour that checks "never handed out again" inside a lease on a clock that stands still is vacuous for the
`sent_at is null` filter (use a zero lease), and a check that exists only in the fake's own test file binds the fake, not the
adapter (D-100). Count Vitest unhandled errors as kills, or a crash-only fault (listener `once`) looks like a survivor.
Related: [[lost02-audit]], [[bug-test-patterns]], [[shadowed-guards]]

**LOST-07 (2026-10-07): the lesson did not carry to a copy.** escalation.ts copied the open's two-loop structure; LOST-02's A4
(waiting attempt that throws not stuck) and A15 (break after a failure) both survived again at every level. When a module copies
another's loop, plant the old loop's faults on the copy first.
