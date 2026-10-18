---
name: bug34-audit
description: BUG-34 (client-level 5 s connect timeout, ConnectTimeoutClient in createPool) test audit, PASS at befe3ed (HEAD 4141e77, memory/docs only after); pool-level form and constant value unpinned (should fix)
metadata:
  type: project
---
Audited 2026-10-18 (cloud). Red 3023816 (5 BUG-34 tests + guard, helpers listeningSilentPostgres/settledWithin/HANG_CEILING_MS
in fake-postgres-server.test.ts), fix befe3ed (db.ts only; no test file differs between the two).
- RG-02 replay in memory (Vite transform returning git show 3023816 db.ts): exactly the 5 red, each on "still waiting ... real-time
  ceiling" at ~5.1 s; guard green on red and fix.
- 26 faults on db.ts (stdin harness, no files): killed: timeout dropped, named-only/worker-only/api-only/unnamed-only/not-api (each
  pool's row catches its own), x2, +1, -1, 1 s, 10 s, 5 ms, client/pool query_timeout (guard kills, "Query read timeout"),
  statement_timeout in place, config not spread (heard() never), reject-without-destroying-socket wrapper (allClosed kills).
  SURVIVED: pool-level connectionTimeoutMillis (alone or with Client) - pg-pool passes its options to the Client, so the handshake
  timer is set either way; constant raised to 10 s / 60 s (tests read the constant; START_LIMIT_MS relation unpinned);
  connect+statement_timeout (server-side, fake ignores; L3 only); option order swapped (equivalent).
- Appended probe (full pool max 1, held client, queued acquire, advance 3x CONNECT_TIMEOUT_MS on fake timers, still waiting, release,
  gets the same client): passes on HEAD and red, kills both pool-level forms. Fails by 60 s test timeout unless held is released in finally.
- Graphile 0.18 completeJobBatchDelay default -1: completeJob promise unawaited at dist/worker.js:283, so the design reason holds.
- Load: 8 busy loops on 4 cores (load ~10): 5/5 targeted runs and 2/2 whole-file runs (228 tests) green. Fake timers drive pg's
  timer; real waits are only the 5 s hang ceiling and a 100 ms not-yet floor that only affects fault detection.
- RG-03: only import lines removed; tests:changes none weakened. RG-04 baseline untouched. RG-05: db.ts in no mutation group
  (gate-decisions.mjs: database adapters L3-only, nightly run not built), so CI mutation says nothing about it; hand faults are the evidence.
- gate:integrity 5 of 5 (NODE_USE_ENV_PROXY=1). Pushed at 4141e77, no PR, check-runs total_count 0.
- safety-reviewer independently found the same two should-fixes (pool-level, START_LIMIT relation).
Related: [[rejected-alternative]], [[in-memory-mutation]], [[load-proof-floors]]

**Loop-1 delta (2026-10-18, c74d569 + 52f510b). PASS.** Full-pool test kills pool-level alone and beside client form in ~15 ms
("timeout exceeded when trying to connect"), releases held/late in finally; pool-level value above 3x CONNECT_TIMEOUT_MS
(15001) survives (finite window; advancing hours on fake timers would cost nothing - note). Constant 10 s, 60 s, 100 ms and 1_100
die (strict floor); 1_101 and 9_999 survive by design. START_LIMIT_MS export 4 s / 20 s dies on the agree check with the file's
own copy. RG-03: only moved statements, pool?.end() and the reworded guard comment removed. Load: 6/6 targeted + 231/231 whole
files at load ~12. gate:integrity 5 of 5; pushed at 52f510b, no PR, check-runs 0.
