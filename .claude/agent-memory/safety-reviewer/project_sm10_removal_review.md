---
name: sm10-removal-review
description: SM-10 removing a responder review 2026-10-09, PASS at e3d8e42; reset/round/unheard design facts, 10 L3 adapter mutants all killed, real-worker probe recipe; should-fix: unheard alerts silent when HEALTHCHECKS_SMS_URL unset (worker start line + M3 hand-off)
metadata:
  type: project
---

## Round 1: 689a0b5...e3d8e42, PASS
Design: removal.ts (no route in M2) = plain read -> transition 'remove' -> store removeInside: set_config lock_timeout
LOCK_WAIT_LIMIT_MS -> journeys FOR UPDATE (waits) -> responders read -> rule again -> delete (exactly 1) -> unresolved
alert + alertTransition 'acknowledger_removed' -> guarded update (OPEN, ack null, sms_raised_at null, round+1) ->
withdraw WITHDRAWN_WHEN_RESET (ACKNOWLEDGED) of that alert -> withdraw WITHDRAWN_WHEN_REMOVED of journey's alerts to the
removed responder -> NO_RESPONDER (journey_id, alert_id null, round 1) when lastResponder. Every insert reads
alerts.round in SQL. escalateInside: exists(responders) as heard under lock, skip only on === false; zero-row insert
guard kept. alertsDueForEscalation excludes no-responder journeys; unheardAlertCount; sms-check failing on either.
Open no longer throws on zero responders. Unique key (alert, recipient, kind, round); check num_nonnulls = 1.
Verified myself:
- L6 removal+escalation+alerts system 192/192; L2 domain+fake+log+fake-log+fake-push+worker 791/791; L3 PG16
  removal+escalation+alerts integration 70/70, journeys+deploy integration 210/210.
- 10 adapter mutants at L3 (scratch config spreading vitest.lost02-l3.config.mjs + enforce:'pre' transform, MUTANT env):
  reset keeps sms_raised_at, no round raise, unheard inverted, no lock_timeout (AC18 "still waiting"), no for update,
  no removal withdrawal, no reset withdrawal, warning always: killed by removal/escalation/alerts integration.
  no heard skip + read without exists: survive those 3 files, killed by journeys.integration shared suite (AC15 x2).
- Real worker probe (startWorker(uri, undefined, {log, smsAlarm stub, write})) over fresh PG16 db: last responder
  removed -> NO_RESPONDER claimed (NOT_CONFIGURED retries); open with no message; beat 6 s fresh; first sms_check
  failing + unheard_alerts 1; heartbeat -> BACK_IN_CONTACT, no stand-down; next check failing only by sms_unsent.
  Escalated alert acked by B then B removed -> OPEN round 2 sms null; ACKNOWLEDGED notice to C withdrawn; next sweep
  ESCALATED round 2, one SMS to C only. ~2 min.
Should-fix given: HEALTHCHECKS_SMS_URL unset -> unheard alert pages nobody and writes NO log line (sweep ok, check off);
before SM-10 it failed the sweep (worker check paged). Not live in M2 (no caller; staging set by A-33). Fix: record as
M3 hand-off (route only where SMS check is required / worker refuses or warns), worker start line to name unheard
alerts; optionally a closed line when the open writes zero messages.
Notes: removal_ignored logs caller's journeyId (upper-case -> null; could log read's canonical id); the outbox check
names no kind, so an alert kind with journey_id escapes the unique key (single writer today; a later migration can tie
kind to journey_id); ESCALATED+ack_by only from seeded data leaves round-1 unsent SMS beside round 2; journeys group now
runs removal.system for every service.ts mutant, CI margin 3:53 unmeasured; group test files still unowned.
Related: [[lost07-sms-review]], [[lost06-ack-review]], [[reviewer-sandbox-limits]].
