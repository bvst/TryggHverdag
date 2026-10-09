---
name: bug29-audit
description: BUG-29 / D-117 audit (worker.ts gets its own mutation group, commands start node node_modules/vitest/vitest.mjs run) - PASS at 2a65c3a; 31 faults killed; how the "narrower set" claim was checked
metadata:
  type: project
---
2026-10-07 cloud, branch claude/busy-faraday-40n2zl (PR #67, LOST-07's), delta 53a5a85..2a65c3a. **PASS.**
- RG-02 replay (tests at HEAD = 7e2d2bc against gate-decisions.mjs + stryker.config.mjs served from 53a5a85): exactly 14
  red (11 stryker-config + 3 gate-decisions). CI's unit/traceability on 7e2d2bc show only 10 annotations: GitHub caps
  annotations at 10 per step, and the 4 hidden were the declared-bin test and the 3 gate-decisions tests. Job logs
  redirect to a blob host the built-in gh refuses, so replay locally rather than trusting "CI shows exactly N".
- 31 in-memory faults, all KILLED, no-op control survived (94 pass): worker.ts back in process (4 forms), worker group
  tests/config/name changes, order swaps (after process, front, end), command forms (pnpm exec, pnpm exec node, npx,
  per-run conditionals, missing bin vitest.js and bin/vitest.mjs, no `run`, .bin shell script), declared bin moved /
  missing / version mismatch, whole-suite fallback dropped, worker report file, worker break 0, worker loses --bail.
- "Narrower set can only score lower": per mutant, Killed(S') implies Killed(S) except via timeouts; a narrower set can
  turn a Timeout into a real Killed, so "only lower" is slightly overstated but "never falsely higher" holds (fewer
  tests also means fewer flaky kills). Checked by diffing two no-bin reports keyed mutator@start-end|replacement
  (scratch mut-split/worker-only.json vs reports/mutation/worker.json: 0 diffs). The with-bin JSON had been overwritten;
  only the 15:25 scratch log (lost07-loop2-impl-mut-process.log) remained: same counts, same 4 survivors by line:col.
  The 2 timeouts' identity in the with-bin run was not re-checkable.
- bin test (`node <bin> --version`, env PATH+HOME): no socket syscalls (strace), works under `unshare -n`, ~0.1 s idle,
  0.4-0.7 s with 8 busy loops on 4 cores. spawnSync has no timeout of its own (pre-existing pattern in filesRunWith).
- Stryker 10 command runner: `exec(command, {cwd: sandbox, env: {...process.env}})`, and Stryker itself starts under
  `pnpm exec stryker run` (proc.mjs merges process.env), so dropping the inner pnpm exec changes no env a test sees.
Harness: scratchpad/ta-bug29/ta-harness.mjs <mutants.mjs> [id-prefix]; serves GD/SC/both tests from disk or `git show`,
mutant `f[path](text, rep)`; NOTE the id filter is a prefix match (RG02 also runs RG02b/c).
A parallel safety-reviewer Stryker run creates .stryker-tmp/ in the root mid-audit: check `ps` before blaming yourself.
Related: [[gate-integrity-local]], [[in-memory-mutation]], [[stryker-incremental-reuse]], [[mutation-pooled-score]]
CI run of record: `mutation` on 2a65c3a **success**, its step 19:11:20 to 19:32:27 (21:07, 3:53 under the 25-minute budget;
local 18:57). Per-file numbers not readable (the log is on the blob host); success implies every run finished and every file >= 80 %.
