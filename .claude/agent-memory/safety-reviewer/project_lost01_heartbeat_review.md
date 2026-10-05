---
name: lost01-heartbeat-review
description: LOST-01 review 2026-10-03 (PASS ff583fb, loop-1 re-check PASS 19db407) — heartbeat route, D-101 device rule, phone-time range, row lock deferred to task 3; open: 400 resent by SDK (spec says otherwise), lock bound + race test due in task 3
metadata:
  type: project
---

Reviewed origin/main...ff583fb on claude/busy-faraday-40n2zl. PASS. Loop-1 re-check at 19db407: PASS.

Loop 1 (verified myself at 19db407):
- recordedAt refine: UTC year 1..9999 (heartbeats.ts), fake isStorableMoment mirrors it, behaviour suite has
  out-of-range + edges, L6 REFUSED_HEARTBEATS has 3 new 400 rows asserting nothing stored, last contact unchanged.
  Probed the schema: zod already refuses +0100, +01, :60, Feb 30, lower-case t/z; NaN year is refused by refine.
- SQL is now greatest(last_heartbeat_at, $t): relies on PostgreSQL GREATEST ignoring NULLs; behaviour AC1 starts
  from null last contact, so L3 holds it (CI only; no check runs existed at 19db407, no PR open yet).
- sqlstateOf in domain/sqlstate.ts (owned, safety path, mutated), MAX_LINKS 8, used by adapter, service, log.ts.
- log.ts throws on unlisted event (type-impossible today); journeyId null unless lower-case UUID, but the contract
  lowercases journeyId (z.uuid().toLowerCase()) so SM-07's line keeps the ID.
- Mutation reports: journey.ts 72/73 (:145 throw text), sqlstate.ts 25/26 (:38 < to <=), service.ts 61/62
  (:103 'refused' literal in start race; api.ts switches on reason). 0 Timeout, 0 "timed out" kills.
- Live ruleset 23864486: active, bypass_actors [], 13 required checks. gate:integrity fails locally only because
  the script cannot read the API without a token; gh api through the proxy can.

Open (check before repeating):
1. Spec LOST-01 line ~277 says the 400 avoids "a 500 the phone would resend for ever", but its own F8/item-3 text
   says the SDK keeps ANY refused record and resends it; M3's 4xx list (403, 404, 409) omits 400. A 400 is also
   unlogged server-side, where the 500 left heartbeat_failed 22008. Safe direction (false alarm), should-fix docs.
2. Task 3 (LOST-02 watchdog): must bound the heartbeat row lock (idle_in_transaction_session_timeout /
   lock_timeout, or no indefinite skip locked) with an L3 test, plus the L3 race test (heartbeat waits on an
   uncommitted ENDED, answers ended, stores nothing). Recorded in spec item 6, adapters/journeys.ts header,
   docs/progress/m2.md "Left for later tasks".

Earlier notes still true: reading 7 (LOST_CONTACT + heartbeat stays LOST_CONTACT) safe direction; migrate-then-start
overlap (M5); credential rotation must keep device ID (D-101). capture.test.ts (PRIV-07 capture helper) is unowned.

**How to apply:** on task 3 check item 2 first; on any phone-sent timestamp check the PostgreSQL/JS range edge;
on M3's upload task check that the app handles 400 (drop + tell walker), not just 403/404/409.
Related: [[bug10-journey-safety-paths-review]], [[reviewer-sandbox-limits]].

**2026-10-04 (LOST-02, 6f27b80): open item 2 CLOSED.** API pool idle 10 s + lock_timeout 5 s, worker pool idle
10 s, as startup parameters; L3 AC17 (25P03 end, 55P03 refusal) and AC11 (heartbeat waits on uncommitted ENDED,
pg_stat_activity Lock) exist. See [[lost02-alert-review]].
