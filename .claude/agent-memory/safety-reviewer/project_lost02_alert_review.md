---
name: lost02-alert-review
description: LOST-02 review 2026-10-04 (PASS 6f27b80, loop-1 PASS 3539d4f, loop-2 PASS 25f5ccf) — watchdog, own outbox, beat fed by the sweep, session limits + read-back (D-109), per-open lock_timeout, lockWaitMs refused outside 1..2^31-1; open: read-back search key, per-journey cost wording, pool limits accept 0
metadata:
  type: project
---

Reviewed origin/main(7e05c8e)...6f27b80 on claude/busy-faraday-40n2zl. PASS. Loop 1 at 3539d4f: PASS. Loop 2 (delta
3539d4f..25f5ccf): PASS.

Loop 0 facts still useful:
- Drizzle emits 'for update' / 'for update skip locked'. pg 8.23.0 sends lock_timeout / idle_in_transaction_session_timeout
  as startup params (client.js 561-565), BUT connection-parameters.js:60 lets URL query fields override them.
- graphile 0.18 gracefulShutdownAbortTimeout maps (lib.js:92). Healthchecks.io worker check: Period 1 min, Grace 2 min,
  page about 3 min after last ping. A hung delivery is fully silent (beat fresh): documented, task 8 canary owns it.

Loop 1 facts: openInside always runs set_config('lock_timeout', lockWaitMs ?? 5000, true); progress.rowTaken set after the
journey-row select; users-row 55P03 is thrown (failed open). Only the watchdog calls openLostContactAlert, first attempt
lockWaitMs undefined, second pass LOCK_WAIT_LIMIT_MS (watchdog.ts:100, :117).

Loop 2 (verified myself at 25f5ccf):
- journeys.ts refuses lockWaitMs not integer 1..2147483647 BEFORE the try/transaction (so never answered held). Emulated
  with a stub db {transaction} + the real adapter: 0,-1,0.5,NaN,+-Infinity,2^31,null,"5000" refused, tx never reached;
  1, 5000, 2^31-1 reach it. Real watchdog with fake store held row + second attempt routed to the real adapter with 0:
  sweep {ok:false,opened:0,stuck:1}, watchdog_failed open code null, watchdog_overdue, beat null. Loud.
- db.ts durationOf Object.hasOwn: stricter only (constructor/__proto__ were NaN, never in force; now "unreadable", no echo).
  createPool, POOL_SIZE, listeners, read-back logic unchanged. Fake now refuses the same range (D-100 parity).
- Ran: worker, api-process, fake-postgres-server, fake-journey-store, database-imports, db tests 443/443; alerts.system
  49/49. Mutation reports all == HEAD source (watchdog 87/87, outbox 37/38, worker.ts 97.3 %, sqlstate 96.2 %).
  adapters/journeys.ts is not in SAFETY_PATHS (L3 only), so the refusal's bounds are proved by the shared suite at L3.
- No Docker daemon (client only), so L3 (11a, 13a, 14a, 15a at L3) not run by me; no check runs at 25f5ccf, no open PR.
- Orchestrator committed 56efb8a (records) on top DURING the review: outside the range; read only its left-for-later block.

Open (check before repeating):
1. Should fix (loop 2): spec's read-back step (cad3fa4) and progress.md (56efb8a) say find "api: session limits" lines:
   the API's mismatch lines start "api: session limit <name> is ..." (singular), so the key misses them; and "no line
   found" is not named as a finding. Fix: prefix "api: session limit" / "worker: session limit", expect the two exact
   in-force lines, anything else or nothing opens a bug.
2. Note: per-journey-cost entry says "each such journey is stuck and pages (AC20)": before 5:30 it is a failed open
   (AC19, watchdog_failed open 55P03), stuck only past 5:30; the page is the owner's via the stopped beat, the journey's
   responders hear nothing until the users row is free.
3. Note: createPool lockTimeoutMs/idleInTransactionMs 0 would be sent and read back as "in force" (0 = no limit). Today
   pinned by literal lines in api-process.test/worker.test (5000/10000). Same refusal belongs in createPool later.
4. progress.md row 3 still "Red phase, 24 acceptance criteria" (spec has AC25), even after 56efb8a. Fix at merge record.
5. db.ts not in SAFETY_PATHS: now an owner question in spec + progress.md (with log.ts's).
Related: [[lost01-heartbeat-review]], [[bug18-db-owned-review]], [[reviewer-sandbox-limits]].
