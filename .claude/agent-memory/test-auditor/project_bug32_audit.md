---
name: bug32-audit
description: BUG-32 (worker installs exitOnSignal before its start; stop awaits the start) audit, PASS at 33e27ac/3c6b6ad; 14 faults, only read-back ordering (M12) and an equivalent survive
metadata:
  type: project
---
Audited 2026-10-08 (cloud), branch fix/BUG-32-worker-signal-before-start, red 8e80fc1, green 33e27ac, docs-only head 3c6b6ad. PASS.
- RG-02 replay (serve 8e80fc1^ worker.ts through a Vite `load` hook): only the two test.each rows fail, with the intended
  "nothing listens for SIGTERM/SIGINT while the runner is starting"; the two guards pass at the parent, as their comments say.
- Harness scratchpad/ta-bug32/harness.mjs <mutants.mjs> [id-prefix]: serves worker.ts and worker.test.ts from `git show`,
  `rep()` throws NotApplied unless exactly one match, counts Vitest unhandled errors. One file run takes about 15 s (137 tests).
- Killed: early handler + late exitOnSignal left in (the "stops once" guard), stop swallowing a failed start (only the failed-start
  guard kills it), stop resolving at once, late-bound `worker` in the stop, no-op early listeners (timeout), stop that never stops,
  SIGTERM-only early handler, unawaited stop, runWorkerProcess swallowing a failed start (only the failed-start guard).
- Survived: readLimitsBack moved after untilStopped() (equivalent: still synchronous); readLimitsBack delayed one macrotask after
  `await started` (M12): with a signal during the start, the stop then begins before the read-back exists, so the "stop waits for
  the read-back" (D-109) property is held only by promise-reaction order. Graded Note (the worst case is a misleading read-back line).
- The test-author's claimed table (scratchpad/bug32/mutate.mjs) did not exist; claims re-planted and confirmed.
- Local mutation gave no score: gate:full died on BUG-33 (EISDIR copyfile on infra/staging/.terraform symlink), and the mutation-only
  rerun exited 144. `.terraform` came back at 13:19 (a later static step re-ran terraform init). No PR, so check-runs total_count 0.
How to apply: for any "move a handler earlier and make it await a promise" fix, plant: the old late registration left in, a swallowed
rejection, an immediate resolve, a late-bound variable, and anything that relies on reaction order between two awaits of one promise.
Related: [[bug-test-patterns]], [[in-memory-mutation]], [[gate-integrity-local]]
