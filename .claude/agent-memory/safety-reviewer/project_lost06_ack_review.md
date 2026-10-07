---
name: lost06-ack-review
description: LOST-06 "I'm on it" review 2026-10-06, PASS at 05f054a, loop-1 PASS 5d62a0a; should-fix APNs one-stored-notification displacement of the critical push by the ACKNOWLEDGED notice (M3 hand-off + owner), task 6 escalation key on state AND who
metadata:
  type: project
---

## Round 1: 57502b8...05f054a (code 05f054a), PASS
Design: read first (plain, no lock) -> rule -> only "acknowledged" goes to the store: journey FOR UPDATE (via alert
subquery) -> rule again -> update alerts (unresolved, acknowledged_by null) -> one ACKNOWLEDGED notice per other
responder, due now. resolveInside: withdraws WITHDRAWN_WHEN_RESOLVED (LOST_CONTACT, ACKNOWLEDGED); held CTE groups
withdrawn by recipient, max(next_attempt_at) where attempts>=1 and > now(); coalesce(hold, now()).
Verified myself:
- L6 acknowledgement.system 51/51; L3 PG16 stand-in acknowledgement.integration 13/13, journeys.integration 154/154;
  fake + domain 317/317; api-process -t LOST-06 2/2.
- Adapter mutants at L3 (scratchpad/lost06-safety/vitest.mutant-l3.config.mjs, MUTANT env, spreads
  ../vitest.lost02-l3.config.mjs): two stand-downs per responder, old left join (heartbeat fails with
  HeartbeatStoreError = contact never back), LOST_CONTACT-only withdrawal, no for update in recordAcknowledgement:
  all killed (AC8; AC8; AC7/AC8/AC13; AC3/AC6/AC12).
- Mutation reports (read before gate:full's own run deleted domain.json): journey.ts 173/177, survivors = hasOwn guard
  in alertTransition (false / {} / message) + old transition message. Without the guard an unlisted type throws
  TypeError anyway; only Object.prototype names would return a value; every caller builds type 'acknowledge'
  literally. acknowledgement.ts 37/37, outbox 37/38 (old survivor), watchdog 87/87, api-process 17/17.
Should-fix given: (1) APNs stores ONE notification per bundle ID per device ("in most cases the latest", Apple
"Sending notification requests to APNs", fetched 2026-10-06; apns-expiration 0 = delivered once, not stored). The
notice to an offline responder whose LOST_CONTACT was already accepted can replace it: they come online to a
non-critical notice, and from task 6 no SMS. Not live in M2 (push unconfigured). Fix = record in spec risks + M3
hand-off + D-087 owed tests (L9 real iPhone), tell the owner (D-113 premise "costs nothing"). Due-at-once order is
the SAFER order (later critical push is the one kept). (2) task 6 should escalate unless state=ACKNOWLEDGED AND
acknowledged_by not null; spec says "the decision is the state", which fails open on ACKNOWLEDGED-with-nobody.
Closed: LOST-03 loop-3 notes (tripwire AC13 at journey.test.ts:1996; fake lists pinned :2017).
Open notes: CLAIM_BATCH 50 by due time, notices compete with a new alert's first push (spec hands to M3);
acknowledgement.system.test.ts unowned like alerts.system.test.ts; progress rows still "red phase next".
Related: [[lost03-contact-review]], [[reviewer-sandbox-limits]].

## Loop 1: 05f054a..5d62a0a, PASS (2026-10-07)
Owner chose "keep it, gate M3" (D-113 amendment, D-087 owed-test bullet, Part E item 6, spec). Task 6 rule now
"escalate unless state=ACKNOWLEDGED AND acknowledged_by not null" (spec + D-114). Both met.
5d62a0a: test-only (+2 L6 via test.each, +1 L3) plus a comment-only fake header (checked: every changed line is
" *"). Verified: L6 53/53, L3 PG16 14/14; rule-order mutants (resolved-first, taken-first, injected before the
responder check in domain/journey.ts via scratch transform plugin, scratchpad/lost06-loop1-safety/) killed ONLY by
the new tests (L6 2 fail/51 pass, L3 1 fail/13 pass).
Should-fix given (docs, non-blocking): (1) spec F10 bullet still says "every other responder still gets the
critical push and is told who is on it"; (2) "a notice sent before a responder's critical push is replaced by it"
overstates Apple ("in most cases", not in a short duration, may reorder); L9 procedure tests only critical-then-
notice, add notice-then-critical; (3) FCM notification messages always collapsible, default key = package name, so
Android likely has the same displacement; gate is iOS-only: ask owner to make it per platform.
Open notes: "Where the two meet" says "finds ACKNOWLEDGED" (state only); L9 is M5/Test Lab per roadmap, the gate
test needs offline/online control; progress row 52 still "Red phase next".
