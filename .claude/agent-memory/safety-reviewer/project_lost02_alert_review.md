---
name: lost02-alert-review
description: LOST-02 review 2026-10-04 (PASS at 6f27b80) — watchdog, own outbox, beat fed by the sweep, session limits, pool listeners; open: delivery loop unmonitored (proven silent), startup-param evidence, FK waits on worker pool
metadata:
  type: project
---

Reviewed origin/main(7e05c8e)...6f27b80 on claude/busy-faraday-40n2zl. PASS. (e36a384 after it: requirements-status.md only.)

Verified myself:
- 46/46 alerts.system.test.ts; 617/617 worker, domain, api-process, db, healthchecks, log, test-kit; imports:check clean.
- reports/mutation/*.json sources == HEAD byte for byte; 0 kills by Vitest timeout in alerts/process.
  Survivors: watchdog.ts:87 filter removed, :89 '=== lost_contact' -> true: EQUIVALENT under the port contract
  (SQL read and lock re-check both filter; pg date parse floors ms, so floor(a)-floor(b) >= 300000 whenever SQL
  says overdue). outbox.ts:81 claim-failure return value unused. worker.ts:211 sweeps.cancel() (stop test only
  has the sweep in flight, delivery idle; runNow has no stopping guard), :177 inFlight.delete (leak), :197/198
  loop labels unasserted, :395/398 build-machine strings (pre-existing).
- Drizzle emits 'for update' / 'for update skip locked'; set_config('lock_timeout', '5000', true) in the tx.
- pg 8.23.0 sends lock_timeout / idle_in_transaction_session_timeout at startup (client.js 561-565), BUT
  connection-parameters.js:60 Object.assign(config, parse(url)): URL query fields override the options.
- graphile 0.18 maps gracefulShutdownAbortTimeout (lib.js:92) and aborts via setTimeout(…, it) (main.js:663).
- Experiment (real watchdog + sender, fake store, fakePush.holdAnswers): 5 min of sweeps, beat age 0 ms,
  message unsent, ZERO log lines. A hung delivery is fully silent; worker.ts header and spec item 9 say "a loop
  that stopped would show as a beat that stopped" — false for delivery. No real push until M3 (UNCONFIGURED_PUSH).
- Healthchecks.io worker check: Period 1 min, Grace 2 min (monitoring-setup.md:42) -> page ~3 min after last ping.

Open (check before repeating):
1. Delivery health feeds no monitor (Should fix): correct the claim; record for task 8 (canary must go red on a
   wedged/failing delivery) and M3 (adapter send timeout).
2. Deploy log shows only REFUSED startup params, not silently ignored ones (pooler): ask for a read-back
   (show idle_in_transaction_session_timeout / lock_timeout) at process start. AC20's page is the backstop.
3. Worker pool has no lock_timeout: the open's outbox insert takes FOR KEY SHARE on users rows (FK), so a manual
   FOR UPDATE/DELETE on a responder's users row wedges the WHOLE sweep (others not opened). Loud via beat.
   Cheap fix: transaction-local lock_timeout in every open. Spec item 7 "never wait for a row" is incomplete.
4. progress.md row says 24 criteria / red phase; spec has 25.
Closed by this PR: LOST-01 item 2 (row lock bounded, AC11 race test at L3); BUG-18 note 6 (progress row).
L3 not run by me (no Docker); CI integration on PG15 is the evidence.
Related: [[lost01-heartbeat-review]], [[bug18-db-owned-review]], [[reviewer-sandbox-limits]].
