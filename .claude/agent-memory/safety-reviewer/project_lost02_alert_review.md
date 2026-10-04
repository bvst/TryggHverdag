---
name: lost02-alert-review
description: LOST-02 review 2026-10-04 (PASS 6f27b80, loop-1 PASS 3539d4f) — watchdog, own outbox, beat fed by the sweep, session limits + read-back (D-109), per-open lock_timeout; open: read-back evidence step untracked, per-journey 5 s cost, lockWaitMs 0
metadata:
  type: project
---

Reviewed origin/main(7e05c8e)...6f27b80 on claude/busy-faraday-40n2zl. PASS. Loop 1 re-check at 3539d4f: PASS.

Loop 0 facts still useful:
- Drizzle emits 'for update' / 'for update skip locked'. pg 8.23.0 sends lock_timeout / idle_in_transaction_session_timeout
  as startup params (client.js 561-565), BUT connection-parameters.js:60 lets URL query fields override them.
- watchdog.ts:87/:89 survivors were EQUIVALENT (SQL filters too). graphile 0.18 gracefulShutdownAbortTimeout maps (lib.js:92).
- Healthchecks.io worker check: Period 1 min, Grace 2 min (monitoring-setup.md:42), page about 3 min after last ping.
- Experiment: a hung delivery is fully silent (beat fresh, zero lines). Now documented as such (loop 1).

Loop 1 (verified myself at 3539d4f):
- Should-fix 1 CLOSED: worker.ts header, spec item 9, D-108 amendment, README say only the sweep loop is watched;
  task 8 canary + M3 per-send bound are in the spec's "Left for later tasks" (not yet in progress/m2.md: copy at merge).
- Should-fix 2 CLOSED: db.ts sessionLimitsLines reads pg_settings (name, setting, unit) once per process, fixed lines,
  never rejects; API not awaited (stop waits for it), worker via readLimitsBack() in runWorkerProcess. Dropped params read
  as 0ms, so a pooler shows. Lines hold only process name, constant setting names, digits+unit, SQLSTATE or none.
  Quirk: MS_PER_UNIT is a plain object, so unit 'constructor'/'__proto__' passes and is echoed (harmless).
- Open note 3 CLOSED: openInside always runs set_config('lock_timeout', lockWaitMs ?? 5000, true). progress.rowTaken set
  after the journey-row select, so held only for the waiting attempt's own-row wait; users-row 55P03 is thrown, the watchdog
  catches per journey (watchdog_failed open 55P03; stuck past 5:30). Healthy race (AC7) unaffected: loser skip-locks first,
  never reaches users/alerts index. FOR KEY SHARE conflicts only with FOR UPDATE (DELETE, key-column UPDATE, explicit).
- runNow stopping guard + untilStopped awaits the whole stop (pool end). Migration 0003_true_sir_ram = old 0003 + outbox
  partial index; prevId chain OK; old 0003 never on main; no 0004. PUSH_FAILURE_REASONS/MESSAGE_KINDS in domain/journey.ts
  feed ports, schema check, log; test-kit keeps its own copy (pinned in fake-push.test.ts; tsc guards a shrink).
- 550/550 unit (worker, api-process, db, log, healthchecks, domain, test-kit fakes, alerts module), 49/49 alerts.system.
  Mutation reports == HEAD: watchdog 87/87, outbox 37/38, worker.ts 140 killed, 4 survived (159 equivalent, 183 leak,
  427/430 build strings), 2 Timeout (170, 187: infinite-again mutants). No check runs at 3539d4f, no open PR (gh api).
- Guard hook blocks a grep whose pattern holds the Clever deploy command phrase: use Grep/Read tools on workflows.

Open (check before repeating):
1. D-109 says reading the read-back line after the first deploy is the check, but no owner to-do / merge checklist names
   who reads it or where (stderr: Clever Cloud app log; whether the deploy job log shows it is unverified). Should fix.
2. One held users row costs 5 s per overdue journey naming that responder, every sweep (read has no ORDER BY). Note.
3. lockWaitMs 0 = no limit in PostgreSQL; adapter passes it through, fake answers held. Only caller passes 5000. Note.
4. progress.md row still "Red phase, 24 criteria" (spec has 25). Fix at merge record.
5. sessionLimitsLines is in db.ts (not SAFETY_PATHS): no mutation run; 2b tests catch "mismatch read as in force".
L3 not run by me (no Docker). Related: [[lost01-heartbeat-review]], [[bug18-db-owned-review]], [[reviewer-sandbox-limits]].
