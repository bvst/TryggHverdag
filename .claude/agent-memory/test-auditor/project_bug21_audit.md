---
name: bug21-audit
description: BUG-21 (e2e-android waits judged by the script's own Date.now via a --import observer, e5c6d2e) - PASS with two should-fixes; 26 faults in a tree copy; install-interval faults I5/I6 killed by main's file survive the new one
metadata:
  type: project
---
PASS at e5c6d2e (2026-10-14, HEAD 87e8314 = + psr memory only). Test-only: scripts/e2e-android.test.mjs; script unchanged.
- Harness: scratchpad/ta-bug21/{run.mjs, mutants*.mjs, base/} - `git archive HEAD` tree + node_modules symlinks (6 dirs),
  main's test copied in as scripts/e2e-android-old.test.mjs; per mutant cpSync + exact-count edits + `vitest run <file>
  --reporter=json`, cwd = copy (SCRIPT = path.resolve('scripts/...') follows cwd). ~37 s per run new, ~26 s old.
- New file kills: locale deadline /2, 0, give-up-after-one (with/without clock read), stop asking after 1 or 2 reads,
  interval=deadline, prod deadline 3 s; install /2 (I1 - survived main's file, as test-author said), give-up-after-one,
  stop asking after 1/2, no interval, interval=deadline, prod deadline 5 s, first-answer-in-message; asks once then
  sleeps the deadline (L10/I11, via the appliedAfter / 20 s third-attempt siblings).
- Survive the new file: I5 install interval env ignored (5 s), I6 interval x4, I10 x2, L7 locale interval env ignored,
  L9 locale no interval. MAIN's file killed I5 and I6 (1065's 1 s deadline + installs > 2 were the only ceiling on the
  interval) -> RG-03 should-fix: the 1 s -> 20 s change's written reason omits it. L7/L9/I10 survive both (pre-existing).
  Load-proof fix proven: preload patches timers/promises.setTimeout + module.syncBuiltinESMExports(), records sleeps.
- T1 (clock := stand-in stamps) and T2 (stopAfter := spawn timeout) turn the BUG-21 tests red; T3 probe
  (clock.length == readTimes.length + 1) passed: nothing else reads Date.now - but unpinned (should-fix).
- Load: new 3/3 and OLD 2/2 passed under 12 busy loops (load 3.6 -> 13); pure-CPU loops do not reproduce BUG-21 here;
  the explicit slowStarts tests are the evidence. I8 (no interval) gave a spurious ENOTEMPTY in rmSync: orphaned
  stand-ins outlive SIGTERM (pre-existing; same with spawnSync's timeout).
- RG-05: `mutation --plan --only-if-safety-paths-changed` = skip (scripts/ not a safety path). No PR, check-runs 0.
Related: [[load-proof-floors]], [[in-memory-mutation]], [[gate-integrity-local]]
