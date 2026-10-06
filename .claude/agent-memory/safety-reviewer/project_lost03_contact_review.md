---
name: lost03-contact-review
description: LOST-03 review 2026-10-06 — round 1 PASS 3471859; loop 1 PASS 2aa23f4; loop 2 PASS 59fe06f (both loop-1 should-fixes closed) with NEW should-fix: the walker-wide withdrawal also withdraws J1's HOME for a responder NOT on J2 (never stood down; SM-04, D-111) — scope by the new journey's responders
metadata:
  type: project
---

## Round 1: origin/main(5cd5d24)...3471859, PASS (code = 6add162)
Verified then: L6 323/323; L3 185/185 on the PG16 stand-in; mutation journey.ts 134/135, service.ts 121/122.
Contact '<' vs silence '>=' consistent; now() is transaction start; withdrawal CTE + stand-down insert one
statement with EPQ re-check; hold bound max(lease 30 s, retry cap 60 s); API + worker are ONE Clever Cloud app.

## Loop 1: 3471859..2aa23f4, PASS
openInside withdrew the journey's earlier alerts' unsent non-LOST_CONTACT messages; recordHome asks transition()
under the lock. Lock order: open = journey row -> outbox rows (withdrawal) -> alerts index -> users key-share;
resolve = journey -> alert -> outbox. Claim skip-locks; marks hold one row one statement, non-FK columns.
Should-fixes given: (1) cross-JOURNEY overtaking, (2) fake recordHome lower-cased walker/device (D-100).

## Loop 2: 2aa23f4..59fe06f, PASS (db97856 after it = BUG-21 docs only, committed mid-review)
Code bd55fea: withdrawal subquery = alerts JOIN journeys WHERE journeys.walker_id = locked.walkerId (walkerId
now selected with the FOR UPDATE row). 59fe06f schema comment only. Header names both withdrawals (accurate:
waiting attempt also uses LOCK_WAIT_LIMIT_MS 5 s, watchdog.ts:117; worker pool idle limit only, worker.ts:293).
Verified myself:
- L3 PG16 stand-in (55432, my scratchpad l3/vitest.l3.config.mjs): journeys + contact + alerts 180/180.
- L6 contact+journeys system 263/263 (needs --config vitest.system.config.mjs; plain vitest run picks up only
  non-system files); fake L2 138/138.
- Mutant via a scratch vitest config with a pre-transform plugin (file in scratchpad/loop2/): fake narrowed
  back to journey scope -> 14a fails on its overtaking assertion itself (J1 HOME accepted after J2 LC).
  Fake re-lower-casing walker/device -> 15a and the fake's own test both fail.
- Loop-1 should-fixes CLOSED.
NEW finding (should-fix, given): the widened withdrawal is walker-scoped but NOT recipient-scoped. Responders
are chosen per start (responderIds). J1 {A,B}: A1 LC accepted by A and B; push fails; "I'm home" -> HOME
pending; J2 {B} silent -> A2 open withdraws A's J1 HOME too. A heard of the loss, is not on J2, is never stood
down (SM-04 "responders get <name> is home"; D-111 owner: never-stood-down responder may call 112). Probed in
the fake world (L6 in-process) AND on the real adapter at PG16 (fresh db, migrateDatabase, insertStarted,
open, markSent, recordHome, open J2): A HOME sent=false withdrawn=true. Fix: add recipient_id IN (select
responder_id from journey_responders where journey_id = this journey) to the withdrawal, fake in step, shared
+ L6 test with differing sets. Spec/D-112 only ever say "same responders". Not live until M3 (worker push is
UNCONFIGURED_PUSH), so should-fix, consistent with loop 1's calibration.
Notes given: ne(kind,'LOST_CONTACT') is a denylist (task 6 SMS kinds would be withdrawn by default; prefer
kind IN stand-down kinds); no walker_id index (recorded by implementer, M6).
Pattern: when a fix widens what is withdrawn/suppressed, list every recipient who loses a message and check
each gets a superseding one; my loop-1 suggestion missed the recipient axis. Own it when it happens.
Related: [[lost02-alert-review]], [[reviewer-sandbox-limits]].
