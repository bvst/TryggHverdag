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

**Loop 1 delta (2026-10-19; red b8bdc3e, fix fa00e6f; HEAD 40b089a = privacy memory). PASS, one should-fix.**
- RG-02: b8bdc3e's tests on 5ee115c's code: 17 red, right reasons (11 behaviour: routing/orphans/unknown tool/
  needsScript+needsEnv/L3-named orphan via main(); 6 missing-export: budget constants, L3_NEEDS_DOCKER, hook limit,
  settings test, which is a guard in substance since 180-170 already >= 5). fa00e6f 101/101.
- RG-03: only PATH restores swapped to restorePath (stricter); the "fit" -> "end inside" rename was pre-commit, so
  no committed name changed. Detector false positive: test-strength.mjs:36 `\bf(?:it|describe)\b` counts the word
  "fit" in prose. Fails closed; suggested recording it as a queued BUG (note).
- Config move: the `test` sections of all four vitest configs import-hash identical at 5ee115c and fa00e6f.
- Faults (mutants2.mjs, harness2.mjs with BASE/SLOTP env): 22/22 killed: suffix routing, orphans in unit/L6 step,
  orphans dropped, orphan step needs docker, unknown tool quietly not possible (also "only beside docker"),
  needsScript/needsEnv not refused, refusal after steps started (spawn doMock has teeth), hook literal timeout
  (only by a source-regex shape test; acceptable), step 160 s, literal limit, main literal timeout (setTimeout spy),
  probe 30 s (proc doMock has teeth), margin 0, gate:full reason retyped, UNIT_EXCLUDE ignored, packages/ L3 glob
  dropped, old M24 and M16 now killed.
- SHOULD FIX (same as privacy reviewer, found independently): post-edit.mjs statically imports gate-file.mjs ->
  vitest.shared.mjs + lib glob/proc/steps/test-strength. A file in that chain that fails to load makes the hook exit 1
  (non-blocking in Claude Code) for EVERY edit, docs too; 5ee115c exited 2 with the SyntaxError. Reproduced with
  `import { NOT_YET_EXPORTED } from './lib/steps.mjs'` and with a syntax error in vitest.shared.mjs. Backstop:
  stop-gate.mjs imports only lib.mjs and spawns gate:quick, plus CI, hence should-fix not blocking. A prototype of a
  guarded dynamic import (try/catch -> block) gives exit 2 with a clear message and docs edits still exit 0;
  the hook test's static-import regex would have to accept it.
- Determinism: vi.doMock + resetModules in withMocked are undone in finally, the only dynamic import, no concurrent
  tests, default isolate; setTimeout spy is pass-through and restored. Load 3/3 at load 7.5-12 on 4 cores, slowest
  3.8 s vs 30-120 s ceilings. Coverage gate-file.mjs 96.84 % lines / 92.75 % branches from the two files.
