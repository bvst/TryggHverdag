---
name: bug17-audit
description: BUG-17 (e2e:android switches the emulator to bokmal itself, D-140, f7d4e2a/9caa720/9597d9f) - PASS with one RG-03 should-fix (AC9 applied-after-3 count diluted by the fix's getprop/setprop calls) and B4 unpinned
metadata:
  type: project
---
PASS at 9597d9f (2026-10-22). Red f7d4e2a: 17 failed / 399 passed of 416 in the three files; HEAD 416/416. Two guard tests
(already-bokmal, entry and lib) green at red by design. Red reasons: switchToBokmal not a function (lib), switch calls [] or
message lacking persist.sys.locale (entry), -change-locale in ci.yml (gate).
- Harness: scratchpad/ta-bug17/{run.mjs, run-red.mjs, mutants*.mjs}: git worktree add --detach into the scratchpad, symlink
  root + apps/* + packages/* node_modules (without apps/mobile/node_modules 12 entry tests fail on expo/config - harness error,
  not red), mutate in place, vitest --reporter=json, restore. ~50 s per entry-script mutant. Remove worktrees after.
- 32 faults: all killed except B4 (switch only when the language is wrong, package clause of D-140 ignored) and G6 (comment-only
  control). F3 (deadline restarted after the switch) killed by the BUG-21 waitByItsClock checks.
- Should fix (RG-03): INF-06-AC9 "applies bokmal only after it has booted" counts calls.filter(isLocaleRead).length > 3;
  isLocaleRead matches \blocale\b, so the fix's per-reading getprop persist.sys.locale and the setprop count too. "Pass on
  the 2nd/3rd reading whatever it says" survives that test at HEAD, killed by it against main's script (run-red). 10 other
  tests still kill it. Fix: count isConfigRead / readTimes.
- Timeline helper still counts getprop as a question (3 per reading now, was 2); traced MAC_RECORDING by hand: install still
  only in 'ready', framework-down still visited; meaning holds.
- decideMutation: skip (scripts/ not safety, no inputs). gate:integrity 5/5 with NODE_USE_ENV_PROXY=1; pushed, no PR, check-runs 0.
Related: [[script-change-dilutes-count]], [[bug21-audit]], [[entry-script-wiring]]
