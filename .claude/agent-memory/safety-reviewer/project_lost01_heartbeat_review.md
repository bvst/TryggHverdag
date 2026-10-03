---
name: lost01-heartbeat-review
description: LOST-01 review 2026-10-03 (PASS at ff583fb) — heartbeat route, D-101 device rule, AC20 migration refusal; open: phone-time range contract/fake vs PostgreSQL, unbounded row lock vs task 3 skip locked, no behavioural lock test
metadata:
  type: project
---

Reviewed origin/main...ff583fb on claude/busy-faraday-40n2zl. PASS (no Blocking).

Verified myself:
- Fresh Stryker: domain 141/142 (journey.ts 72/73, survivor :134 unreachable-throw message), journeys 66/68
  (service.ts :56 optional chaining for a null rejection, :110 `type: 'refused'` in start race — api.ts reads
  reason not type), api-process 8/8. 0 timeouts, 0 kills by Vitest timeout (statusReason grep).
- L2/L6: 361 + 179 tests green. eslint clean; modules/ clock rule fires on new Date() and Date.now().
- PostgreSQL 16 refuses '0000-01-01T00:00:00.000Z' (22008) and '+010000-…' (JS toISOString of
  9999-12-31T23:59:59-14:00). zod z.iso.datetime({offset:true}) accepts both inputs; fakeJourneyStore records them.
- api-process.test.ts:387-394 pins `for update` inside begin…commit by SQL text; DATABASE_NOW is 2031, so a
  process-clock mutant fails.
- drizzle-orm 0.45.3 pg-core/dialect.js:60 runs all pending migrations in one transaction (AC20 is whole).
- Only writer of last_heartbeat_at: adapters/journeys.ts recordHeartbeat, reached only via service after the
  domain's walker/ENDED/device checks. api.ts is now in CODEOWNERS (closes BUG-10's open item).

NOT verified: L3 (no Docker; local PG run killed, see reviewer-sandbox-limits), CI deploy-staging on AC20.

Open should-fixes (check before repeating):
1. Contract + fake accept phone times PostgreSQL refuses (year 0000; UTC year 10000): contract-valid body ->
   500 loop -> SDK queue wedged -> false alarm. D-100 parity. Fix: bound recordedAt's UTC instant to years
   0001-9999 in heartbeats.ts, mirror in fake-journey-store.ts, add both strings to tests.
2. Journey row lock has no bound (createPool: no idle_in_transaction_session_timeout/lock_timeout). With task
   3's `for update skip locked`, a frozen/partitioned API instance mid-heartbeat hides the journey from the
   watchdog until TCP keepalive (~2 h Linux default) = missed alert. Spec item 6 claims skipping is "correct:
   that phone is alive". Must be settled before task 3's watchdog merges.
3. No behavioural L3 test of a heartbeat racing a concurrent state change (only text pin). Due with task 3 or
   the first task that ends a journey.

Notes: reading 7 (LOST_CONTACT + heartbeat stays LOST_CONTACT) deviates from 05-architecture's draft table,
documented, safe direction; 400 encoder keys on status not code; migrate-then-start overlap breaks old code
on NOT NULL adds (M5); credential rotation must keep device ID (D-101) for the login task.

**How to apply:** on task 3 (LOST-02 watchdog) check items 2 and 3 first; on any timestamp field from the
phone, check the PostgreSQL/JS range edge. Related: [[bug10-journey-safety-paths-review]],
[[reviewer-sandbox-limits]].
