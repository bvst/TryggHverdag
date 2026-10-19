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

**Loop 2 delta (2026-10-19; red cc81aad, fix 84cb623, docs 8568ed8 = BUG-53/54 queued). PASS, one should-fix.**
- RG-02: cc81aad's hook tests on 40b089a's hook: 8 red (6 "blocks" cases + 2 docs cases), all because node exits 1
  on the static import; 8568ed8 30/30. The temp-copy tests follow the hook's imports (static and dynamic) and
  have a control (intact copy passes), so an incomplete copy cannot fake a block.
- RG-03: the one changed test is new on the branch (b8bdc3e). It loosened two source regexes (accepts a dynamic
  import and `x.GATE_FILE_LIMIT_MS`) and added a forbid on `GATE_FILE_LIMIT_MS = <digit>`. tests:changes clean.
- Faults (mutants3.mjs, harness3.mjs with TESTS env): KILLED import before the early exits (two placements),
  failure swallowed with a fallback module, empty catch, catch exit 1, message without error/file/"could not be
  loaded", static import restored, block replaced by a stderr write. SURVIVED: fallback limit
  `gate.GATE_FILE_LIMIT_MS ?? 170_000`, `|| 170_000`, `?? LIMIT` const (the regex matches only the prefix;
  should fix, low impact: needs the export to vanish, which the suite's Number check catches; at HEAD a vanished
  export means spawnSync with no timeout, bounded only by the gate's own 15 s + 150 s timers). Q08 import placed
  between the ext filter and the package.json check: near-equivalent (note).
- Leftovers: hook-test-* count unchanged across runs (a transient 4th disappeared); one gate-file-main-in-process
  dir from 11:26 came from a loop-1 mutant run, not a normal run; removed. Load 3/3 at load 7.5-13, slowest 3.3 s.

**Loop 3 delta (2026-10-19; red f5e25db, fix d04c930, hook only). PASS, notes only.**
- RG-02: f5e25db's hook tests on fa4d9e2's hook: 20 red, right reasons: renamed/null/0 ran the gate with no limit
  (exit 0); string/NaN/negative/Infinity/fraction died in spawnSync with ERR_OUT_OF_RANGE (exit 1), proving the
  test's claim; 9 location tests lack path:line; the 2 docs tests are red through their same-copy checked-edit
  control. d04c930 53/53. RG-03: only the fs import line re-added expanded; tests:changes clean.
- Faults (mutants4.mjs + mutants4b.mjs, harness3.mjs): 24/26 KILLED: check removed alone or with ?? / || / ?? LIMIT /
  ternary fallback, isFinite, >= 0, typeof number, undefined-only, too strict (<= 170_000), check after the gate
  ran, message without file / "no checks ran", reload removed, location from input cwd (symlink test), absolute
  path, file:/// URL, full-stack-only, reload 1 ms, AT_LINE without m, no line, whereItBroke throwing on non-Error,
  where never printed. SURVIVED (notes): location from process.cwd() and a relative GATE path in the reload
  (tests always run the hook with cwd = project root; Linux and macOS getcwd resolve symlinks; the hook already
  needs cwd = root for package.json, so equivalent in practice); reload-only (same outcome, extra child spawn).
  S02f first draft declared `r` twice (a SyntaxError "kill"): re-planted as a real check-after-gate fault.
- Load 3/3 at load 6-11, slowest 3.9 s vs 60 s spawn ceiling; reload child 10 s cap only on the failure path.
  hook-test-* count unchanged, no gate-file-* dirs.

**Loop 4 delta (2026-10-19; red 0b1a515, fix ae082f5; HEAD a75f867 = privacy memory). PASS, notes only.**
- Design: the hook loads no repository code; `const GATE_FILE_LIMIT_MS = 170_000` as the timeout; the gate runs
  only in the child. Tests: TypeScript-parser import scan (followed through lib.mjs; node:module/vm/worker_threads
  refused), AST pins on the const and the single `timeout: GATE_FILE_LIMIT_MS`, a --import preload recording the
  timeout really passed (and shortening it to 3 s in the two hang tests), load-gate.mjs writing started/loaded.
- RG-02: 23 red on ab6d864's hook, right reasons (scan finds import(), no const, gate.X timeout, child never
  started, exit 13 in the hook, hook itself hung). ae082f5 52/52.
- RG-03: main's tests untouched (only an import line); 10 main expects intact. 109 -> 103 is branch-internal:
  12 unusable-limit tests replaced by static pins (export safe int > 0, hook literal equal); symlink and
  repo-relative path:line dropped because the hook no longer computes a location (node prints file:///..:line);
  6-expect helper shared by 18 tests. test-weakening.mjs compares against git HEAD, so the cp-then-Edit route
  still ran the full comparison (it flagged the drop).
- Faults (mutants5.mjs, harness3.mjs): 22/22 KILLED: guarded import back, static gate/vitest.shared import, computed
  import, 160_000 / 170_001, env default / env in timeout / let reassigned, status === 1 / > 0 / signal ignored,
  no r.error branch / ENOENT-only / ETIMEDOUT passes, lib.mjs importing scripts/lib or node:module, hook importing
  node:vm, timeout removed (recorder sees 'none' though the preload imposes 3 s), spread after timeout, timeout twice,
  message without file. Env-limit faults die only to the AST pin (recorder runs with env unset).
- Real pnpm killed at the limit orphans its node child (verified: ppid 1, still spinning). The tests exec node through
  a shim to avoid it; in real sessions a gate that hangs forever leaves a spinner per checked edit. Pre-existing
  (same spawnSync on main); note, suggest queueing (detached spawn + group kill, as gate-file runStep does).
  CAUTION: `pkill -f "node spin.mjs"` killed my own shell (exit 144): use a bracket pattern like `spin[.]mjs`.
- Load 3/3 at load 8-9, slowest 4.3 s; hang tests about 3.2 s. No hook-test/gate-file dirs or node orphans left.
