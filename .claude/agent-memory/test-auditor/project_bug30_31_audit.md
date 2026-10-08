---
name: bug30-31-audit
description: BUG-30/BUG-31/HK-04 (agent model+effort pins, stop-gate fingerprint memory, review-job stand-down, parallel gate:file) audit, PASS at 75ca5d1; survivors are the fingerprint's null fallback, untracked rename, merge-base and gate-file main()
metadata:
  type: project
---
Audited 2026-10-08 (cloud), branch fix/BUG-30-31-agent-models-and-gate-speed, head 75ca5d1 (later 7d408b1, memory only). PASS.
- RG-03: only import lines removed in 4 test files; test-helpers.mjs runHook deletes TRYGGHVERDAG_REVIEW_JOB (stricter). No baseline change.
- Hook mutants via NODE_OPTIONS=--import loader (scratchpad/ta-bug31/drive.sh + hooks.mjs, TA_MUTANT JSON in env; runHook/stopIn/checkIn
  spread process.env so it reaches the hook child). ~2.5 min per mutant on stop-gate.test.mjs (29 tests).
  Killed: HEAD/diff/hash-object dropped, diff --name-only, .claude/state exclude dropped, gate name unhashed, fingerprint taken after run,
  --exclude-standard dropped, stand-down `||`/`!== undefined`/removed (both hooks), remember-after-stop_hook_active.
  Survived: `parts.includes(null)` -> return constant (skip forever after one green when an untracked nested repo or dangling link
  exists; verified hash-object fails "Unable to hash" on a nested repo dir) and guard removed (crash); untracked list dropped
  (rename with same content); merge-base dropped (near-equivalent); rmSync(passedFile) on failure dropped (near-equivalent).
- gate-file runSteps via startVitest transform (scratchpad/ta-bug31/gf-harness.mjs): all runSteps faults killed; main()'s
  `results.filter(!ok)` -> [] survives (main never tested, pre-existing); "Still running" note cosmetic survivor.
- gate-file.mjs measured 77.35/71.87 vs baseline 61.9/60 (gain not locked in).
How to apply: for any "memory/cache skips a check" change, plant: each fingerprint part dropped, null/unknown fallback turned into a
constant, rename-with-same-content, and fingerprint computed after the run.
Related: [[bug-test-patterns]], [[entry-script-wiring]], [[in-memory-mutation]], [[gate-integrity-local]]
