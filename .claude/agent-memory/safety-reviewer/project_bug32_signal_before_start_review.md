---
name: bug32-signal-before-start-review
description: BUG-32 review (worker stop signal before start), PASS 33e27ac; held SIGTERM during a hung start is silent
metadata:
  type: project
---

BUG-32 (fix/BUG-32-worker-signal-before-start, head 33e27ac): exitOnSignal now installed before
`await started`, stop = `async () => (await started).stop()`. PASS.

Verified: worker.test.ts 137/137; repro-bug32.mjs vs local PG16 at 55432: 10/10 exit 0 (the
42P01 "failed" lines in its output are the fresh db lacking app tables, not the stop).
Microtask order: runWorkerProcess's `await started` is registered before any signal can fire, so
readLimitsBack runs before stop(); on a failed start runMain's "worker failed:" + exit(1) runs first.

Open should-fix: a start that HANGS (TCP accepted, no answer; no connectionTimeoutMillis on
createPool) now swallows SIGTERM with no line until the platform SIGKILLs (measured: still running
15 s after SIGTERM, nothing written). Before the fix the signal killed it at once. Ask for a line at
signal time and a bounded wait (exit 1), plus a connect timeout as its own task.
Docs: progress.md line ~444 still says BUG-32 "Not started".

Pattern: when a stop is made to wait for a start, ask what happens if the start never ends.

**Loop 1, 0429693: PASS; should-fix resolved.** A signal during the start writes one line at once and waits
for the start at most START_LIMIT_MS = 10 000 ms (Promise.race + global setTimeout cleared in finally); on
expiry the stop rejects, exitOnSignal says "worker failed while stopping" and exits 1 without ending the pool
(right: pool.end on a pending connect could hang; exit drops sockets, PG releases everything; no loops run
before the start returns). Measured myself: hang-bug32.mjs exit 1 after 10.016 s with both lines;
repro-bug32.mjs vs PG16 5/5 exit 0 (first connection ~1 s under a concurrent mutation run).
worker.test.ts 143/143. D-109 order: runWorkerProcess's `await started` registered before the race's then,
guarded by a held-pg_settings test. Clever Cloud's stop grace is recorded nowhere in the repo.
Open note: progress.md BUG-32 row and m2.md record do not yet describe loop 1.
BUG-34 (no connect timeout, hang without signal) and BUG-35 (once-listener, second SIGTERM) correctly queued:
both predate, both end loudly enough (Healthchecks.io page / death by signal after the at-once line).
Forgot TMPDIR=<scratchpad>/tmp on the vitest run this time: one /tmp/<id>/ssr folder of mine may remain.
