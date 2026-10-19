---
name: bug51-audit
description: BUG-51 (D-132 statement_timeout 10 s, QueryLimitClient 15 s per-query limit + give-back, keepalive 10 s) test audit, BLOCK at 4233657 (HEAD 5b547d7): the limit's disarm and per-query arming are unpinned; sync-throw leak real
metadata:
  type: project
---
Audited 2026-10-18 (cloud, fresh run after a container restart). Red 3f94034 (tests + 2 stub constants), green 4233657
(db.ts, api-process.ts, worker.ts only; no test file differs between them). HEAD 5b547d7 = reviewers' memory only.
- RG-02 replay in memory (harness serves 3f94034's three production files): 296 pass / 32 fail, each for the right
  reason ("still waiting 15000 ms", keepalive 0, statement_timeout undefined, read-back lines). Matches the brief.
- RG-03: tests:changes "none weakened"; every changed existing test carries "RG-03 (BUG-51, D-132)"; no assertion
  removed; toHaveLength(2)->3 plus a statement_timeout line; new mismatch line pinned only by `.+` (reason text
  survives rewording, F22). IDLE_AS_ASKED renamed LIMITS_AS_ASKED. RG-04 baseline untouched. RG-05: db.ts in no
  mutation group; no PR, check-runs total_count 0.
- Faults (scratchpad/ta-bug51/{harness,mutants,mutants2,mutants3}.mjs, Vite load hook, no repo writes). KILLED: pg
  query_timeout only, destroy w/o give-back, release() w/o end, pool-level connectionTimeoutMillis (BUG-34 full-pool
  test), limit 14/16 s (constant pin) and timer +/-1 ms, +/-1 s, limit on migrations' pool (guard), statement_timeout
  off api / worker / createPool, keepalive off/0/20 s/api-only, statement_timeout out of SESSION_LIMITS, holder
  release reaching pg-pool after give-up (double-release throw).
  SURVIVED (blocking set): timer never cleared (F11), callback path unwrapped (F12), promise path never clears (F13),
  limit armed per hand-out (F20, also whole worker+api files). Each cuts healthy connections 15 s after a query.
  Probe TA-PROBE (answered query by pool.query and checked-out client, advance 2x limit, same connection answers)
  passes on HEAD and kills all four. SURVIVED (note): no end (equivalent: pg-pool _remove ends), release() w/o
  error (equivalent), handedOut bookkeeping (stray-timer only), submittable refusal, checkSessionLimit for
  statementTimeoutMs (refusal test covers only the two old options), keepalive on migrations' pool (harmless),
  give-up emitting 'error' (killed by a stdout==[] probe in the hung /v1/health test, passes on HEAD).
- Sync-throw leak (code-reviewer) confirmed: TA-SYNC probe (query(null) on a checked-out client, advance 2x limit)
  fails on HEAD with "Client was closed and is not queryable"; arming the timer after send passes it.
  safety-reviewer found the worse form: stray timer ends an IDLE client, next hand-out's release swallowed, place lost.
- `void this.end()`: pg 8.23 end() promise only resolves (client.js 811-817): not a defect.
- Load: 8 busy loops on 4 cores (load to ~10): 8/8 runs of the four files, 328/328. Real waits are 5 s ceilings and
  100 ms not-yet floors (floors only weaken fault detection); eventually() is turn-bounded.
- L3 gap: no real-PG test of startup statement_timeout -> 57014 with the connection reused (should fix);
  L3 named pools are few and short-lived, so F11/F20 would not be caught there either.
- gate:integrity 5 of 5 (NODE_USE_ENV_PROXY=1), 13 required incl. mutation/traceability.
Related: [[disarm-faults]], [[rejected-alternative]], [[bug34-audit]], [[in-memory-mutation]]

**Loop 1 delta (2026-10-19, 5ffa62e tests, 9300e8e fix, 1e3f5e8 guards; HEAD 33eddcd = D-132 text + memory). PASS.**
- RG-02: HEAD tests vs 4233657's db.ts: 16 red (the 12 of 5ffa62e plus 4 of 1e3f5e8's "guards", which are guards only
  relative to 9300e8e: queued-query ETIMEDOUT, values-as-callback with undefined after), each for the right reason;
  vs 9300e8e: 0 red. RG-03: only `.+` -> exact line (F22), refusal loop +statementTimeoutMs (F18), hung /v1/health and
  sweep tests gain stdout/stderr capture + marker/database_error checks; none weakened (tests:changes 5 files).
- Faults (mutants4/5/6.mjs): killed F11, F12, F13a (resolve side), F13c (callback wrapper), F20, F18, F22, SYNC,
  old at(-1) detection, values-callback ignored, ETIMEDOUT everywhere-after/never/promise-only/callback-only/57014/any
  failure/SQL in message, config-callback refusal removed or too broad (reused pool.query config), submittable refusal.
  SURVIVED: F13b (reject handler never clears: a checked-out client ended 15 s after ANY failed query, 55P03/57014
  included) - probe TA-REJ (fake handler throws 55P03, hold 2x limit, same connection answers) passes HEAD, kills it:
  should fix. ARM (timer armed after send): reachable only on a checked-out client's callback path with an unencodable
  param; the test-kit fake throws on pg's Close ("C") after a bind failure, so no unit test can reach it (note).
  AT3 (values-fn preferred over callback) near-equivalent. Old equivalents unchanged (F03, F14-16, F19, F06c).
- L3: ran database.integration.test.ts against local PG16 (unshare initdb, port 55433, fresh `create database` per run;
  a reused DB fails two older tests on stale beats): 12/12; statement_timeout dropped kills the BUG-51 L3 test
  ("expected '0' to be '500ms'"); client limit at 1 s does not (expected: 500 ms cancel first).
- Load: 6/6 runs of the four files, 360/360, 8 busy loops (load to ~8).
- gate:integrity 5 of 5; no open PR, check-runs 0.
