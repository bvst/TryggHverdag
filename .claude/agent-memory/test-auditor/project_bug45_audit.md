---
name: bug45-audit
description: BUG-45 (mutation check as plan + one leg per group + aggregator `mutation`; D-129/D-130) audit at 89688b1/73681ae - BLOCK on RG-04 (workflow-lint.mjs and gate-integrity.mjs coverage dropped); 89 in-memory faults; tree-copy harness
metadata:
  type: project
---
2026-10-13 cloud, branch claude/busy-faraday-40n2zl, red 0481b8a, fix 89688b1 (HEAD 73681ae adds docs/memory only). **BLOCK (RG-04).**
- coverage:ratchet red (caller's gate:full log scratchpad/bug45-gate-full.log, and my own measurement): workflow-lint.mjs lines
  97.76 -> 93.82, branches 96.34 -> 93.63 (new needsOf list form, lines 287-295, and the no-needs return, 277, untested);
  gate-integrity.mjs 50.63 -> 50 / 58.18 -> 56.14 (fanOut built inside main(), only reached by spawned children). Baseline
  untouched, no written reason. The implementer's commit listed gate:quick/test:unit/test:system only, never test:coverage.
- RG-03 fine: worker.test.ts/canary.system.test.ts change fixtures only (turnBound, answers identical within the bound) plus an
  afterEach that fails on a passed bound; CI-12 exceptions read from CHECKS, and merge-rules.test pins the one fanOut entry, so
  loosening CI-12 needs a test edit. Whole-file job-level-if count kills a quoted job id findJobIds misses.
- AC12: green reports' embedded `source` equals HEAD's run.ts/worker.ts (compare JSON `files[p].source` with `git show`); keyed
  mutant diff (mutator|replacement|original text) showed only the 4 Timeout->Killed and 2 Timeout->Ignored; the reshaped while
  condition's mutants all Killed. Named BUG-45-AC12 tests fail in 2-3 s on 271:15 and on the stand-down wait drop (planted myself).
- Survivors (should-fix/notes): aggregator accepts an unparsable verdict file (A19); entry point ignores MUTATION_PLAN_RESULT
  (E01, `result: 'success'` survives); verdict `name` mismatch, unexpected verdict-only files, `--aggregate` with no value,
  the plan's reason newline strip (P03), workflow-lint's always() regex unanchored (L06/L07; the real file is pinned exactly by
  gate.test CI-12 and AC8, so only the lint is loose), needs list form (L09).
Harness: scratchpad/ta-bug45/run.mjs <mutants.mjs> [prefix]: `git archive HEAD | tar -x` into tree/, symlink root and
apps/server node_modules, `git init && commit` inside (gate.test reads git), per mutant edit file(s) on disk with exact counts,
`vitest run --reporter=json`, restore. Children spawned by tests see the mutant (no loader needed). `void (` replacing a
multi-line `push(` with a trailing comma is a syntax error: "KILLED (fail 0, pass 0)" means my mutant broke the file; use `[].push(`.
gate:integrity 5/5 with NODE_USE_ENV_PROXY=1; no PR for the branch, check-runs total_count 0.
Related: [[baseline-vs-main]], [[entry-script-wiring]], [[in-memory-mutation]], [[narrowed-mutation-group]]
