---
name: bug29-worker-group-review
description: BUG-29 / D-117 review 2026-10-07 (PASS at 2a65c3a) — worker.ts split from the process group (no bin.test.ts), Stryker command `node node_modules/vitest/vitest.mjs run`; verified by planted mutants and ranged Stryker runs; open notes: D-066 not pointed at D-117, thin CI margin, future bin.test.ts-only worker.ts assertions would only survive
metadata:
  type: project
---

Reviewed 53a5a85..2a65c3a on claude/busy-faraday-40n2zl (LOST-07's PR #67 carries it). PASS. Six files, no product code.

Verified:
- mutationRuns(): 8 runs, every SAFETY_PATH exactly once; worker = worker.ts <- worker.test.ts process.test.ts;
  process = bin/worker.ts + process.ts <- bin.test.ts worker.test.ts process.test.ts. Triggers unchanged (worker's tests
  are a subset of process's). reports/mutation/worker.json unique; mutation.mjs unchanged.
- `vitest list --filesOnly` with the direct bin collects exactly the named files for worker and process.
- node_modules/.bin/vitest is a pnpm sh shim: `exec node "$basedir/../vitest/vitest.mjs"` plus NODE_PATH. Same file as
  the direct path (vitest 5.0.1, @types/node@26 variant). No group test reads npm_*/PNPM_*/NODE_PATH/INIT_CWD; only
  bin.test.ts spawns (process.execPath, PATH + __STRYKER_ACTIVE_MUTANT__ only). No .npmrc use-node-version.
- 16 planted worker.ts mutants a real process would show (keepProcessAlive body, writeToStderr body, build-branch stop
  -> undefined, exitOnSignal removed both branches, keepAlive() removed, untilStopped removed, catch emptied, pool.end
  dropped, read-back dropped, build check false, BUILD_INSTANCE '', noHandleSignals false, build return removed,
  stopRequested check false): all killed by worker.test.ts + process.test.ts alone; equivalent control survived.
- Stryker STRYKER_RUN=process (committed config): 29/29. STRYKER_RUN=worker --mutate worker.ts:436-573: 46/48, the 2
  survivors (505:9, 508:26 string literals) are the same the old group left. 0 kills via Vitest's 20 s timeout.

Open notes (check before repeating):
1. D-066's status line still names no amendment; its text says `pnpm exec vitest run apps packages`. D-117 says it
   "amends D-066's grouping" only.
2. Local 18:57 is 4-core; CI/local ratios 1.04-1.32 project ~23 min on CI: ~2 min margin. Running out is loud.
3. A future worker.ts behaviour asserted only in bin.test.ts would just survive (file at 96.8 %, needs ~30 survivors
   to fail). bin/worker.ts header already says worker behaviour is tested in worker.test.ts.

**How to apply:** on the next mutation-group PR, check whether 1-3 landed. Related: [[mutation-gate-checks]],
[[bug12-mutation-gate-review]], [[bug14-gate-files-owned-review]].
