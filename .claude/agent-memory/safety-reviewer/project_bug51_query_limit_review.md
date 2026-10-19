---
name: bug51-query-limit-review
description: BUG-51 review (statement_timeout 10 s, QueryLimitClient 15 s per-query limit that ends the client and gives its pool place back through the release setter, keepalive 10 s), PASS b962f3a; Graphile completion crash path and stray-timer pool leak found
metadata:
  type: project
---

Reviewed origin/main...b962f3a (code 4233657, tests 3f94034; b962f3a = privacy notes only) on
claude/busy-faraday-40n2zl, 2026-10-18. First run lost to a container restart; this one started fresh. PASS.
328 tests in db/worker/api-process/fake-postgres-server pass (~7 s). L3 not run (no Docker daemon, no 55432).

Verified in node_modules (pg 8.23, pg-pool 3.14, graphile-worker 0.18.0):
- pg-pool _acquireClient assigns client.release = _releaseOnce(...) on EVERY hand-out (index.js:342), which is
  what QueryLimitClient's setter catches; _release(err=true) -> _remove: filters _clients synchronously, then
  client.end(cb) whose once('end') fires -> _pulseQueue, so a queued acquire is served.
- pg client.end() with an active query destroys the stream (client.js ~800); 'end' -> _errorAllQueries with
  plain Error('Connection terminated'), no 'error' event (because _ending): so no database_error line.
- pg query throws synchronously only for a null/undefined config (client.js:674) or a non-function
  config.callback; a config object WITH a callback returns undefined (no promise) -> limit timer never cleared.
- Graphile 0.18 default completeJobBatchDelay/failJobBatchDelay = -1 (main.js:376), worker.ts sets neither:
  completeJob/failJob are batchCompleteJobs(... withPgClient.withRetries ...) called UNAWAITED (worker.js:262,
  283). withRetries retries only 40001/40P01/57P03/EHOSTUNREACH/ETIMEDOUT (lib.js). So the batch +
  gracefulShutdown path the privacy reviewer described is NOT the live one; it is an unhandled rejection.
- No unhandledRejection handler in apps/server. Cron errors are caught and restarted (cron.js:255).

Probes (scratch server.ts in scratchpad/probe answering only simple 'Q' queries; extended protocol = never
answered; piped via node --experimental-strip-types --input-type=module-typescript from apps/server):
1. Graphile's own batchCompleteJobs over createPool('worker') + makeEnhancedWithPgClient(makeWithPgClientFromPool)
   unawaited, server never answers: process exit 1 at 15.0 s, Node's own "Error: Connection terminated" stack,
   no "worker failed:" line, no pool end. Pre-fix: hung forever.
2. Stray timer: c.query(null) throws, release; reuse at 8 s (resets pg-pool's 10 s idle reap); at 15 s the
   stray limit ends the IDLE client (not handed out, so no give-back), it stays in _idle; next hand-out's query
   "Client was closed and is not queryable", its release swallowed by #givenUp -> place lost for ever;
   pool.connect() still waiting 5 s later, total 1, 0 database_error lines.

Mutants (scratch vitest config spreading vitest.config.mjs, root apps/server, include src/**/*.test.ts,
enforce:'pre' transform on db.ts keyed on MUTANT), db+worker+api-process (315 tests):
killed: noGiveBack (11), noSwallow (10), keepAlive delay 0 (2). SURVIVED: noEnd (equivalent while handed
out: pg-pool's _remove ends it), noRefuse (submittable TypeError untested), noHandedOutGuard (only reachable
via a stray timer; would throw double-release inside a timer -> crash).

Findings given (all Should fix / Notes):
1. D-132 claims loops "keep running throughout": false when a Graphile completion/failure is in flight
   (canary run, heartbeat task's DB read then failJob): worker exits 1 -> the owner-rejected "exit the
   worker" mechanism arrives as a side effect; Clever Cloud restart still unverified. Better than pre-fix for
   sustained hangs; worse for a 10-30 s stall overlapping a completion (pre-fix self-healed via TCP
   retransmit). Loud (stderr + Healthchecks), outbox leases lose nothing. Options: record + owner to-do, or
   give the limit's rejection code ETIMEDOUT so Graphile's withRetries retries.
2. Stray-timer leak: clear the timer when send throws; swallow only the given-up hand-out's release;
   treat config.callback like a callback (or refuse it).
3. No line says the limit fired (watchdog_failed code null = same as a reset); record in D-132 or add one.
4. No L3 test that real PG enforces startup statement_timeout (57014, connection usable); read-back proves it
   at deploy (worker's only by chance, BUG-27).
5. void this.end(): pg 8.23 end() never rejects; leaving it unhandled is the loud choice. Refuted as a defect.

Related: [[bug34-connect-timeout-review]], [[reviewer-sandbox-limits]]

**Loop 1 (2026-10-19), b962f3a..1e3f5e8: PASS.** 360 tests in the 4 unit files pass. L3 (new 57014 test in
database.integration.test.ts) not run by me; read only.
- Fix: rejection now Error with code ETIMEDOUT (message names QUERY_TIMEOUT_MS and D-132); timer cleared when
  send throws; config.callback refused; answer detection mirrors normalizeQueryConfig (callback arg, else
  function values); promise path returns the wrapped promise; every query taken before the end gets ETIMEDOUT.
  The release swallow is STILL per client (#givenUp), not per hand-out as D-132's amendment words it.
- Re-probe (probe/server.ts now answers extended protocol at Sync via `extended: () => boolean`): unawaited
  batchCompleteJobs, DB answering from 20 s: ETIMEDOUT at 15.0 s and 31.8 s, retried on new connections,
  answered 37.2 s, exit 0. Real bin/worker.ts vs fully hung DB: exit 1 at 16.0 s, "worker failed: Error: No
  answer from the database within QUERY_TIMEOUT_MS (15000 ms)..." (migrate is not withRetries).
- Mutants (probe/vitest.mutant2.config.mjs, 14): all killed except noEnd and noHandedOutGuard, both
  equivalent now (the limit can fire only mid hand-out once a refused query leaves no timer).
- Found: Graphile withRetries logs NOTHING per retry (lib.js 370-392), so D-132's "a Graphile retry line" is
  false. withRetries also wraps getJobs (incl. taskIdentifiers), failJobs, resetLockedAt, getQueueNames:
  ETIMEDOUT now makes the job FETCH back off (3 s x 1.5^n, cap 120 s, jitter 0.5-1.5) instead of failing to
  the 2 s poll, so after a hang of ~8+ min the minute check-in, sms_check and canary (Graphile cron, concurrency
  2) can resume up to ~3 min after the DB answers. Watchdog/delivery/escalation are worker.ts loops, unaffected.
  Residual exit after 100 retries ~3.5 h, loud (console.error + unhandled rejection).
