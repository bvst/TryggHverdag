---
name: bug52-audit
description: BUG-52 (D-133) gate:file runs each edited test at its own level (L6 system config, L3 integration config + needsTool docker, not-possible note) and the post-edit hook passes a passing gate's output on as hookSpecificOutput.additionalContext; PASS at 5ee115c
metadata:
  type: project
---
Audited 2026-10-19 (cloud). Base 0df5737 = origin/main. Red 4832887, fix fd21ad0 (production only, no test touched),
red 42ecf5e (in-process availableFor/main tests), exports 5ee115c. HEAD 62b55c4 = privacy reviewer memory only.
- RG-02 replay with git-archive tree copies (node_modules symlinked root + 5 workspace packages): 4832887 19 red
  (15 gate-file + 4 hook), each for the right reason; the L6 main() red shows Vitest's own "No test files found ...
  exclude: **/*.system.test.ts". fd21ad0 0 red; 42ecf5e 8 red, all "TypeError: availableFor/main is not a function"
  (Vitest SSR import turns a missing export into a TypeError per test, not a file-load failure); 5ee115c 0 of 75.
- RG-03: only import lines removed (re-added expanded); tests:changes "2 changed, none weakened". RG-04: baseline
  untouched; the two files alone give gate-file.mjs 96.1 % lines / 90.56 % branches (baseline 86.88 / 77.77).
  Hooks are outside the coverage include by design (scripts/**, packages, apps only). RG-05: scripts/ and the hook
  folder are not in SAFETY_PATHS; no PR, check-runs total_count 0.
- Faults (scratchpad/ta-bug52/{harness,mutants}.mjs: 3 slot copies, write mutant, run both files, restore; ~10 min
  for 30). KILLED all 11 named in the brief plus variants: L6->unit, L3->system, not-possible counted as failure,
  ok:true (only the runSteps toMatchObject kills it), line not printed, Docker probed always/never/assumed true,
  else-if restored (all, unit-only, L3-only), hook plain stdout, decision:block (toEqual CONTEXT_ONLY), file name
  dropped, phrase-keyed hook (killed by the "synthetic note" test), exit 2 on note, empty JSON on clean pass, needsTool
  moved, related gets tests, docker version, main ignores available, planSteps bypassed, reason dropped, wording,
  probe timeout 1 ms.
  SURVIVED (notes): note printed BEFORE failures (tail() keeps last 4000 chars, so a long failure would cut it; the fix
  commit claims "come last, so tail() keeps them" but nothing pins it), hook reading stdout+stderr, availableFor cwd
  ignored (equivalent), `.system.` anywhere (near-equivalent), JSON without trailing newline (harmless).
- Determinism: the real L6 run (api.system.test.ts via real pnpm behind a fake) took 2.6-2.9 s warm, 7.5 s cold
  per the commit, against a 120 s spawnSync ceiling and 150 s test timeout; 6/6 runs at load ~8 on 4 cores and 30
  harness runs (3 parallel suites, each spawning a nested Vitest) gave no stray failure. In-process main() test
  restores argv, PATH, exitCode and stdout.write in finally (spy created just before try); forks pool isolates per
  file and the test is last. Only nit: PATH undefined would come back as the string "undefined".
- gate:integrity 5 of 5 (NODE_USE_ENV_PROXY=1), 13 required incl. mutation/traceability/unit/system.
Related: [[entry-script-wiring]], [[in-memory-mutation]], [[gate-integrity-local]]
