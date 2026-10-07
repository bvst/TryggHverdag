---
name: lost07-sms-review
description: LOST-07 SMS escalation review 2026-10-07, PASS at 0b8c3c0; should-fix: /fail built by string append (query URL turns failing into ok), no refusal of one URL for both checks, read-failure stops the escalation undocumented; real-worker page probe recipe
metadata:
  type: project
---

## Round 1: e695e8a...0b8c3c0, PASS (HEAD moved to 8bf61c3 mid-review: privacy reviewer's memory only)
Design: sweep = opens, then escalation.escalateDue() (read alertsDueForEscalation without lock -> domain rule again ->
escalateAlert per alert, skip locked; past 2:30 a waiting attempt LOCK_WAIT_LIMIT_MS; failed/held -> stuck), then beat.
escalateInside: set_config lock_timeout -> journey FOR UPDATE via alert subquery -> raw select of alert + now() ->
alertTransition -> guarded update (state, sms_raised_at = now()) -> insert SMS per journey_responders. Ack withdraws
WITHDRAWN_WHEN_ACKNOWLEDGED after its alert update. claim(db, kinds) shared; claimDue = PUSH_KINDS, claimDueSms =
SMS_KINDS. sms_check = second Graphile cron item; HEALTHCHECKS_SMS_URL unset -> task does nothing (D-079 style).
Verified myself:
- L6 escalation 68/68, alerts+contact+ack 166/166; L3 PG16 escalation 16/16, journeys+deploy 188/188,
  alerts+contact+ack integration 57/57; L2 944/944 (14 files).
- Real worker probe: startWorker(uri, run, { smsAlarm: healthchecksAlarm({ url: 'http://127.0.0.1:PORT/sms' }) })
  over a fresh PG16 db, alert seeded OPEN opened_at now()-125 s: escalated on the first sweep; NOT_CONFIGURED retries
  10/20/40 s; minute check sent HEAD /sms at SMS age ~41 s, HEAD /sms/fail at ~101 s (sms_unsent count 2); after
  recordAcknowledgement both withdrawn, next check HEAD /sms. ~3 min. Script piped into node strip-types from apps/server.
- graphile parseCrontab(HEARTBEAT_CRONTAB) = two items, identifiers heartbeat and sms_check.
- Healthchecks.io docs (fetched 2026-10-07): HEAD|GET|POST https://hc-ping.com/<uuid>/fail and <ping-key>/<slug>/fail
  "Signals to Healthchecks.io that the job has failed".
- Adapter mutants at L3 (scratch plugin config spreading vitest.lost02-l3.config.mjs, MUTANT env): ack withdrawal off,
  push claim all kinds, read ack_by-only, count keeps withdrawn, under-lock ACK-nobody as someone: all killed. Read
  narrowed to state = 'OPEN': killed 6/7 runs only (15-run property, behaviour 1, no examples).
- Mutation reports (source == HEAD): escalation 76/76, sms-check 27/27, outbox 51/51, watchdog 93/93, ack 37/37,
  worker.ts 174/4 survived/2 timeout (survivors on old lines 202, 226, 505, 508), healthchecks 68/68. No domain report.
Should-fix given: (1) healthchecks.ts `${url}/fail`: ?query URL -> failing sent as an ok ping (silent), trailing
slash -> //fail; config + TF regex ^https://hc-ping\.com/ accept both. (2) nothing refuses HEALTHCHECKS_SMS_URL ==
HEALTHCHECKS_WORKER_URL: SMS check's ok pings would keep the worker check green with the beat stale. TF 1.9+ allows
a cross-variable validation. (3) watchdog.ts returns before the escalation when the overdue read fails; only in a
code comment; the pinned test is alerts.system.test.ts:901 (whole-DB failure set), not :875.
Notes: claim-to-send window (claimed SMS sent after an ack); escalate() treats undefined as escalated / someone
recorded; push stand-down held behind failed SMS retry (<= 60 s, by design); escalation.system.test.ts unowned;
A-32 secret unverifiable (gh api environments/*/secrets is 403 through the proxy).
Related: [[lost06-ack-review]], [[reviewer-sandbox-limits]].

## Loop 1: 0b8c3c0..4d7f188, PASS (HEAD 83e80af after it = privacy reviewer's memory only)
Code: config.ts refuses ?, #, trailing / (own reasons, both variables); healthchecks.ts failureAddress = new URL,
pathname minus one trailing slash + /fail (query kept after); worker.ts:528 skips the SMS alarm when worker URL ===
SMS URL; TF regex ^https://hc-ping\.com/[^/?#]+(/[^/?#]+)?$ on both + cross-variable != (TF 1.16); watchdog split into
openDue() then escalateDue() always; domain escalate(): typeof acknowledgedBy === 'string', smsRaisedAt instanceof
Date; EscalateRequest lost afterMs (adapter never used it; fake now const 120_000, pinned by shared suite + domain test).
Adapter journeys.ts: comment-only. alerts.system LOST-02-AC19 set gained escalation_failed read (RG-03 reason written).
Verified myself: L2 517/517 + worker 131/131; L6 4 system files 236/236; L3 PG16 escalation+alerts+journeys 211/211.
Mutants (scratchpad/lost07-loop1-safety/mutant.mjs, multi-pair anchors): watchdog old order killed (escalation AC1 +
alerts LOST-02-AC19); adapter read OPEN-only killed 3/3 at L3 (forced fast-check examples work); domain !== null x2,
config x3, hc string-append, fake 60 s / 121 s, worker no-equal-check: all killed. worker `||` SURVIVES (131/131).
Real TF plans: identical refused (message names both secrets, no value); leading space refused; TAKEN: "/ ", "\",
trailing \n or \t, upper-case UUID, %-encoded char, ping-key/slug. UUID-only regex (lower-case 8-4-4-4-12) refuses all.
Healthchecks.io hc/api/urls.py (raw.githubusercontent, 2026-10-07): ping/<uuid> and ping/<uuid>/ both success;
<uuid>/fail fail; slug routes ping/<key>/<slug> + /fail, NO bare <key>/<slug>/; Django uuid converter lower-case only
(upper-case UUID = 404, never-pinged check, sms_check_failed stage report each minute, stays new).
Should-fix given: (1) alias spellings ("/ ", "\", whitespace, %xx, slug) of the worker's check pass config, the ===,
and TF: SMS ok pings would keep the worker check green with the beat stale; staging-sms stays new. Fix = UUID-only
pattern in TF + config.ts so != compares canonical forms; A-33 catches every alias at rollout (why not blocking).
Relayed privacy note said ok to /<uuid>/ fails and pages: WRONG, /<uuid>/ is a success ping. (2) no runWorkerProcess
test with both URLs set and different (production's config): `||` / `true` survivors at :528 turn the SMS check off
whenever the worker checks in. Fix = one L2 test, checkIns [worker], created [sms], "reports once a minute" line.
Notes: budget overrun = failed run (judgeMutationRun status null), never a pass; test-kit changed so CI runs all six
groups; no check runs exist for 0b8c3c0/4d7f188 (gh api check-runs empty), CI time unmeasured. Stranded JSDoc above
checkLockWait in the fake (millisecondsOf lost its comment).
Own slip: first adapter probe passed `send` (option is `fetch`), so two HEADs went to hc-ping.com with synthetic
paths; proxy answered 403. Name stub options from the signature first.
