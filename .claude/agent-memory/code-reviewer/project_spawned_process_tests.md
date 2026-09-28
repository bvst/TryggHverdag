---
name: spawned-process-tests
description: Review angle for tests that spawn real node processes (apps/server/src/bin/bin.test.ts, BUG-5) — fixed sleeps flake under load, children must be killed in finally
metadata:
  type: project
---

Tests that start real processes (bin.test.ts runs api/worker/migrate under plain node) broke on fixed waits: BUG-5 (2026-09-26) was a 1.5 s sleep, while start-up takes about 0.6 s idle but over 2 s on a busy Mac. The fix was to poll for the output line, counted in attempts (the file's `firstResponse`/`waitForOutput` idiom, not a clock read), then allow a margin after it.

**Why:** a timing flake in a gate teaches people to re-run past red. A child left running by a failed assertion stays up for good. The build-mode worker never exits by itself.

**How to apply:** in any test that spawns a process, flag (1) a fixed `setTimeout` wait that is measured from spawn rather than from a signal the process gives, and (2) a `child.kill` that is not in a `finally`. Also check that a timing change does not weaken the assertions (RG-03): the window may only get longer or be anchored later, never shorter. Inline `new Promise((resolve) => setTimeout(resolve, ms))` is the repo idiom (no `node:timers/promises` anywhere). Duplication of it is a Note, not a finding. Related: [[doctor-false-green]], [[gate-file-silent-success]].
