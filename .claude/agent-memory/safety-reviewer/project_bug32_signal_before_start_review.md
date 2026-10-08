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
