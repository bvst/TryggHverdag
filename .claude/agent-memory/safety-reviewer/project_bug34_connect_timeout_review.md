---
name: bug34-connect-timeout-review
description: BUG-34 review (client-level 5 s handshake timeout on every createPool pool), PASS befe3ed; pool-level-timeout and value mutants survive
metadata:
  type: project
---

Reviewed origin/main (0c0b239)...befe3ed on claude/busy-faraday-40n2zl. PASS.
Fix: db.ts ConnectTimeoutClient (pg.Client subclass, connectionTimeoutMillis = CONNECT_TIMEOUT_MS 5_000) as
the `Client` of every pool createPool makes. Pool options carry no timeout.

Verified in node_modules: pg 8.23 client.js:116 (reads c.connectionTimeoutMillis), :167-175 (timer set BEFORE
con.connect, so DNS/TCP SYN/SSLRequest/TLS/auth all bounded; destroy(new Error('timeout expired'))), :377
(cleared on ReadyForQuery only), :402-413 (callback with err). connection-parameters.js connect_timeout is
libpq-only. pg-pool 3.14 index.js:206-231 queued acquire times out only with options.connectionTimeoutMillis.
graphile-worker 0.18 worker.js:283 `completeJob(job)` unawaited; main.js:899 fn = batchCompleteJobs with
withPgClient.withRetries; lib.js:354-392 retries only codes 40001/40P01/57P03/EHOSTUNREACH/ETIMEDOUT, else
rethrows -> unhandled rejection -> crash (no unhandledRejection handler in apps/server). LISTEN reconnects
(main.js:255-279), getJob errors caught (worker.js doNext, logged at debug).

Probe (node strip-types, own net PG responder): createPool max 1, queued acquire pending at 6.5 s then got the
client; pg.Pool with connectionTimeoutMillis rejected the queued acquire at 5000 ms; server answering 'S' then
silent in TLS: createPool query rejected "timeout expired" at 5005 ms.

Planted mutants (scratch vitest config + enforce:'pre' transform on db.ts, MUTANT env), db.test.ts +
worker.test.ts (219): killed drop, namedOnly, migrationsOnly, hardcoded 60_000 in subclass, *2, dropConfig,
+query_timeout. SURVIVED: poolLevel (pool option instead of Client), both, CONNECT_TIMEOUT_MS = 60_000 / 20_000
(tests read the constant; START_LIMIT_MS not exported, relation unpinned).

Open (check before repeating):
1. Should-fix: no test pins "queued acquire not timed out" (the design choice) nor CONNECT_TIMEOUT_MS <
   START_LIMIT_MS. Worker pool: LISTEN holds 1 of 2, idle_in_transaction 10 s > 5 s, so a pool-level
   timeout could crash the worker via completeJob.
2. Note: client-level still crashes via completeJob if the completion must open a NEW connection whose
   handshake exceeds 5 s (pool idleTimeoutMillis default 10 s reaps idle clients). Loud (stderr + exit 1),
   pre-existing for every codeless connect error (ECONNRESET/REFUSED). Comment overstates.
3. Should-fix/queue: post-handshake hangs unbounded (no keepAlive, no query/statement timeout): detected by
   stale beat -> Healthchecks page (~3 min), not self-healing; API stop() awaits limitsRead unbounded then.
4. 5 s unmeasured vs Clever Cloud; the 0.6-1.1 s figure is BUG-32's LOCAL PG measurement incl. process start.
   No sslmode in the add-on URI today (D-? PRIV-08 open, decisions.md ~1737), so TLS not in play yet.
5. {...config} drops non-enumerable keys: only matters if a `password` option is added (pg-pool hides it);
   would fail auth loudly. Comment/guard suggested.
6. progress.md line ~521 still lists BUG-34 as queued while its row says in progress.
