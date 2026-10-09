---
name: lost08-safe-review
description: LOST-08 "They're safe" + 24-hour end + SM-05 guard review 2026-10-09, PASS at e1891fa; should-fix: expiry's failed first attempt past stuck not counted/named (unlike escalation/open, untested either way), no api-process test for the closure wiring (59:36 survivor); real-worker expiry probe recipe
metadata:
  type: project
---

## Round 1: f4ded6d...e1891fa, PASS
Design: closure.ts = plain read (alertForAcknowledgement) -> alertTransition close -> recordClosure: journey FOR UPDATE
(waits, API pool 5 s) -> re-read under lock -> rule -> journeys ENDED SAFE guarded LOST_CONTACT (exactly 1) ->
resolveInside(..., {except: closer}) (except only filters the stand-down insert; withdrawal + hold unchanged).
expiry.ts = escalation.ts clone, run in sweep after escalation, feeds beat; adapter expireInside via takingTheRow,
set_config lock_timeout, skip locked, re-read journey state + unresolved alert + opened_at + now(), alert_id must match,
domain expire rule, guarded update, resolveInside(EXPIRED) (acknowledger told). Read ordered opened_at, id.
opened_at is written only by the open insert (reset keeps it). Expired count NOT in SweepResult (worker only runNow on
opened/escalated; delivery loop runs every 10 s anyway).
Verified myself: L6 closure+expiry+escalation+alerts 246/246; L2 domain+test-kit+log+worker+api-process+contracts
1274/1274; L3 PG16 closure+expiry 38/38, journeys+deploy+escalation+alerts+removal 297/297.
Adapter mutants at L3 (scratch plugin, spreads vitest.lost02-l3.config.mjs): no except, decision without re-read, no for
update, expiry always waits, told-but-acknowledger: killed by closure/expiry integration. read 23h59, no rule under lock,
read resolved too, insert no retry: survive those, killed by journeys.integration shared suite (AC8 read, AC6 prop, AC21).
alert_id !== -> === null SURVIVES all (equivalent: rule under lock + resolveInside alertId check both guard it).
L6 module mutants: expiry ok ignores failed, watchdog ignores expiries.ok, expiry before escalation: killed.
"failed first attempt past stuck -> stuck" (escalation's behaviour) SURVIVES: nothing pins departure 1 either way.
Real worker probe (startWorker over fresh PG16, seeded alerts opened now()-24h-5s etc, trigger refusing one journey's
ENDED with 23514): due ENDED EXPIRED, LOST_CONTACT unsent withdrawn, 3 EXPIRED pushed {kind,messageId,recipientId};
23h59 untouched; no-responder unheard alert resolved, 0 msgs; refused one -> expiry_failed every sweep, NO alert id,
beat never recorded; after drop trigger ended + beat. ~30 s. Push stub: send returns {outcome:'accepted'}.
Mutation reports == HEAD: expiry 70/72 (2nd-loop expired += 1, count unobserved), api-process 17/18 (59:36
createClosureService({}) -- no process-level closure test; LOST-06 has api-process LOST-06-AC1), journey.ts 336/339
(optional chaining on typed-required responderIds, equivalent; 750/852 old).
Should-fix given: (1) align expiry with escalation (failed first attempt past STUCK -> stuck + expiry_overdue naming it)
or record the difference in D-126 + pin it; loud anyway (beat stops). (2) api-process test for closure wiring.
Notes: deploy overlap -- old worker's open withdraws only old ALERT_RESOLUTIONS, so an unsent SAFE from a close in the
overlap is not withdrawn by an old-worker open (needs >5 min overlap; push unconfigured in M2); rollback leaves
SAFE/EXPIRED unsent forever, unmonitored (non-critical). Fake orders due alerts by insertion, adapter by opened_at.
Related: [[sm10-removal-review]], [[lost07-sms-review]], [[reviewer-sandbox-limits]].
