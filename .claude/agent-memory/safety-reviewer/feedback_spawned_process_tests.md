---
name: spawned-process-test-review
description: Checklist for reviewing bin.test.ts-style tests that spawn a real node process (worker/api/migrate) and assert on exit code, output and timing windows
metadata:
  type: feedback
---

When a test spawns the real process (apps/server/src/bin/bin.test.ts), check:
- `child.exitCode` toBeNull also passes for a process killed by a signal (exitCode null, signalCode set).
  The final `{ code: 0, signal: null }` assertion after SIGTERM is what catches that, so it is load-bearing.
- `exitCode` is set synchronously just before 'exit' is emitted, and `once(child,'exit')` created at spawn
  cannot miss the event. But stdout/stderr 'data' can arrive after 'exit', so output read at exit time may
  be incomplete; await 'close' if the assertion reads output of an exited process.
- A time window can only bound "never" (e.g. "never reaches for the database"); the real "never" must come
  from an in-process test with a fake adapter (worker.test.ts "BUG-3: it never starts a runner there").
- Kill the child in `finally`: a build-mode worker never ends by itself, and 8 orphans piled up once.
- Compare old vs new windows by monotonicity: exit status and error text only ever appear, so a later
  check point catches everything an earlier one did. A window raced against the exit is no weaker as
  long as every exit inside it fails something: an exit code fails `exitCode` toBeNull, a signal fails
  the final `{ code: 0, signal: null }`.
- A SIGKILL safety net in `onTestFinished` cannot turn a failure into a pass (vitest 5.0.1 runTest in
  dist/chunks/run.*.js): onFinished hooks run after the callback, after afterEach, and after a timeout;
  a throw in them only calls failTask; only `test.fails` flips a verdict. It stays safe only while
  *every* test asserts on its child's exit, so a stray kill shows up as `signal: 'SIGKILL'`. The global
  `onTestFinished` binds to getCurrentTest(), so it is right only while tests run sequentially.
- A worker that ignores SIGTERM fails by vitest's 60 s timeout (testTimeout, vitest.config.mjs), not by
  an assertion; measured 2026-09-26 on the BUG-5 redo, with nothing left in `ps` afterwards.

**Why:** found reviewing BUG-5 (2026-09-26). Measured: the "return removed" build-branch fall-through
says ECONNREFUSED ~10 ms after the INSTANCE_TYPE=build line (idle), so a 1.5 s window after the line is wide.

**How to apply:** use on any change to bin.test.ts or similar process-level tests. Related:
[[mutation-gate-skips-test-only-changes]].
