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
**Loop 1 PASS (61d6f0a tests, a2af885 fix), 2026-10-13.** B1 closed: test:coverage 4587 green, `coverage:ratchet --base origin/main`
"32 changed, no drop"; baseline byte-identical to main; workflow-lint now 98.31/97.27 (175/178), merge-rules 100/92.42,
gate-integrity 50.63/58.18 (fanOut map moved to pure `fanOutOf` in merge-rules.mjs). Gains not locked in (note);
scripts/mutation.mjs baseline is a stale 0/0 of 23 lines on main while it measures 55.02/60.
Mutants scratchpad/ta-bug45/m-loop1.mjs (rebuild tree/ from HEAD first): 23/24 killed - A19/A19c (S1), E01/E02 (S2),
aggregateFolder kindOf swap/verdicts-as-reports, L06/L07/L09/L10/L12, fanOutOf x3, gate-integrity `fanOutOf(CHECKS) && {}`
(killed only by gate.test AC10 end-to-end), ci.yml GROUP env/credentials/retention/`${{` in aggregator and plan scripts,
head_ref swapped for base_ref. Survivor L11 (needsOf list loop `break` -> `continue`) near-equivalent: only lone single-token
`      - x` lines later in the job would be added. RG-03: the one changed pin (gate.test ~4238, `--group "$GROUP"`) has a
written reason and gained an env assertion. Verdict file lost `message`; no test ever asserted it (toMatchObject on
name/status/ok) and the aggregator never read it. No PR open for the branch (PR #82 is BUG-42's, merged); 0 check runs.
