---
name: lost03-contact-review
description: LOST-03 review 2026-10-06 — round 1 PASS 3471859 (should-fix same-journey cross-alert overtaking); loop 1 PASS 2aa23f4 (fixed + L6/L2/L3 tests); NEW should-fixes: cross-JOURNEY overtaking (earlier journey's HOME after next journey's LOST_CONTACT, probed), fake recordHome accepts upper-case walker/device the adapter refuses
metadata:
  type: project
---

## Round 1: origin/main(5cd5d24)...3471859, PASS (code = 6add162)
Verified then: L6 323/323; L3 185/185 on the PG16 stand-in; mutation journey.ts 134/135, service.ts 121/122.
Contact '<' vs silence '>=' consistent; now() is transaction start; withdrawal CTE + stand-down insert one
statement with EPQ re-check; hold bound max(lease 30 s, retry cap 60 s); API + worker are ONE Clever Cloud app.
Findings: 1 should-fix same-journey cross-alert overtaking; notes: marks wait on API withdrawal, deploy overlap,
home rule decided twice, contact.system.test.ts unowned, 05-architecture row not annotated.

## Loop 1: 3471859..2aa23f4, PASS
All round-1 items addressed or recorded: openInside withdraws journey's earlier alerts' unsent non-LOST_CONTACT
messages after the move, before the alert insert (same tx); recordHome asks transition() under the lock;
already_ended rename; D-112 amended; spec "Tests added in review loop 1"; 05-architecture row annotated;
deploy overlap in spec "Left for later" (M3 push task) only, not in progress/m2.md.
Verified myself:
- In-process probe (fake world, loader hook editing fake-journey-store.ts 'earlierAlertIds.has(...) &&' to
  'false &&'): HEAD -> port accepts only A2 LOST_CONTACT; mutant -> A2 LOST_CONTACT then A1 BACK_IN_CONTACT.
  The L6 test (contact.system.test.ts 1a) is the same scenario, so it catches it.
- L3 PG16 stand-in: contact + adapters/journeys + alerts integration 177/177. L6/L2: 561/561 (22 files).
- Mutation reports source == HEAD; service 122/123 (:130 literal), journey 134/135, worker.ts 142/146 (2 timeouts
  on loop conditions, pre-existing, worker.ts unchanged vs main).
- Lock order: open = journey row -> outbox rows (withdrawal) -> alerts index -> users key-share; resolve =
  journey -> alert -> outbox. Claim skip-locks and never waits; marks hold one row one statement, no RI
  (non-FK columns). No cycle. 55P03 in the withdrawal is after rowTaken -> thrown -> watchdog_failed, no beat.
- gate:integrity locally: 3/5, the two ruleset checks "could not be read from the GitHub API" (no token in the
  cloud session) — environmental, CODEOWNERS check passes.
New findings given (check before repeating):
1. Should fix: cross-JOURNEY overtaking. Withdrawal scoped to alerts.journey_id = this journey. Probe: push
   failing, J1 A1 opens, "I'm home" -> J1 HOME stand-downs pending; J2 starts (same walker+responders), silent
   5 min -> A2; recover at 0/20-60 s -> port: J2 LOST_CONTACT then J1 HOME, J2 still LOST_CONTACT (10 s recover:
   HOME first). Fix: open also withdraws unsent stand-downs of the walker's earlier journeys (all ENDED, so no
   concurrent resolve on them), or record as M3 must-close. "Claim alerts before stand-downs" makes it worse.
2. Should fix (D-100): fakeJourneyStore.recordHome lower-cases walker/device (asStored); adapter asks
   transition() which compares exactly -> refused -> throws. fake-journey-store.test.ts pins upper-case -> 'home'.
   Not reachable via module (module asks same exact rule first).
3. Notes: adapter header names only the API's withdrawal as what marks wait on (spec item 8 also names the
   open's); ne(kind,'LOST_CONTACT') pinned only in the fake's L2 test (behaviour suite's earlier LOST_CONTACT
   rows are SENT, so sent_at alone excludes them; state unreachable); alerts has no full journey_id index (only
   partial unresolved), the open's subquery scans alerts — fine at private-group scale.
Pattern: when a fix is scoped by an ID (journey), probe the same harm one scope wider (the walker's other
journeys, same responders) before passing it.
Related: [[lost02-alert-review]], [[reviewer-sandbox-limits]].
