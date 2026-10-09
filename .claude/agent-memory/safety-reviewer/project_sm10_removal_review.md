---
name: sm10-removal-review
description: SM-10 removing a responder review 2026-10-09, PASS at e3d8e42, loop-1 PASS 3da9517 (BUG-41/D-124 fsModuleCache + maxWorkers=1 judged safe); reset/round/unheard design facts, 10 L3 adapter mutants all killed, real-worker probe recipe; should-fix: unheard alerts silent when HEALTHCHECKS_SMS_URL unset (worker start line + M3 hand-off)
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
## Loop 1: e3d8e42..3da9517, PASS
worker.ts start lines now name unheard alerts; "not reporting" lines end "Neither an SMS left unsent nor an alert with no
responder left to tell is paged." D-122 consequence + SM-10 Left-for-later: M3 route must not ship without SMS check,
"refuse to start ... or say so loudly" -- should-fix given: a start line already "says so", so M3 could read it as met;
require refuse-to-start / fail a paged check instead.
BUG-41 / D-124 (stryker.config.mjs, D-100): command gains --fsModuleCache --fsModuleCachePath=.vitest-fs-cache
--maxWorkers=1. Verified facts (Vitest 5.0.1, Stryker 10.0.0):
- cache key = sha1(id (absolute path, so sandbox name) + file content + env hash incl. config file contents) -- a stale
  or copied cache can never serve other code; writes are tmp+rename (atomicWriteFile); _metadata.json is plain
  writeFile but parse errors are caught; clearCache (rm -rf) only when lockfile hash (node_modules/.pnpm/lock.yaml
  content) changes -- only a pnpm install mid-run could race it.
- Stryker instrumenter reads __STRYKER_ACTIVE_MUTANT__ from process.env at runtime, so transforms are mutant-independent.
- command runner: exec(cmd, {cwd: sandbox}); dry run = same command, no env; timeout -> tree kill.
- project-reader ALWAYS_IGNORE = node_modules,.git,*.tsbuildinfo,/stryker.log,.next,.nuxt,.svelte-kit + tempDir +
  report files + ignorePatterns; .gitignore NOT consulted, so a root .vitest-fs-cache/ would be copied in (harmless).
- isolate defaults true; unknown CLI flag exits 1 (checked).
- Probe: 4 concurrent cold runs then 4 warm runs of domain tests on one cache dir: all exit 0, 313/313, transform
  54% -> 4%.
- Scratch nocache-*/fscache1-*.json: 1,170/1,170 same status; survivors only in domain(3), journeys(1), worker(6+2 TO),
  so alerts/healthchecks/process/api-process equality alone cannot tell broken reads from kills.
Related: [[lost07-sms-review]], [[lost06-ack-review]], [[reviewer-sandbox-limits]].
