---
name: sm10-responder-removal-review
description: SM-10 (removing a responder, M2 task 7) — a removal creates a new kind of stranger (a removed acknowledger still recorded on a RESOLVED alert); module oracle survived L6+L3; 18-mutant runner recipe; README M4 note checked; three closed log events probed
metadata:
  type: feedback
---

First seen on SM-10 (2026-10-09, HEAD e3d8e42, base 689a0b5). Verdict PASS, one should-fix (test gap), notes otherwise.

**Why:** the shipped code was right under every probe; the gap was again what a NEW kind of stranger does to LOST-06's one-404 guarantee. Before SM-10, `acknowledged_by = me` implied "I am a responder". After it, a removed acknowledger stays recorded on a RESOLVED alert (AC4 keeps the record), so a module pre-check like `state === 'RESOLVED' && acknowledgedBy === responderId -> ignored ALERT_RESOLVED` (equivalent before SM-10) now gives a removed member 409 plus an acknowledgement_ignored line: an existence oracle. It SURVIVED removal/acknowledgement/alerts/escalation system files (246 L6) and removal+alerts integration (51 L3). The domain table (LOST-06-AC14 rows "the sender on it; sent by a non-responder") kills the same change made in the domain. A scratch L6 test (R1 acks, contact back, R1 removed, R1's ack vs a stranger's: 404, same text, no new line) passes on shipped code and kills it.

**How to apply:**
- Whenever a task can take someone OFF a resource (removal, leaving a group, revoked device), list what still names them (acknowledged_by, outbox recipient_id, audit rows) and test that person as a stranger against every state that still names them.
- Removal-specific checks that held: every responder-facing write (open, escalation, resolution stand-downs, notices, ack's under-lock read) reads journey_responders, so deleting the row is the whole exclusion; the removal's withdrawal covers all of the journey's alerts (earlier alerts' stand-downs included) by recipient; PushMessage unchanged (messageId, recipientId, kind), AC12 pins the key set.
- README "Open for M4" WAS in the docs commit this time (round columns, journey messages a by-alert retention misses, deleted rows), but it overstated "no longer holds anyone removed": a RESOLVED alert's acknowledged_by keeps them.
- M3 notes to carry: the removal module has no actor or authorisation (who may remove whom), its answers distinguish JOURNEY_NOT_FOUND / NOT_A_RESPONDER / JOURNEY_ENDED (collapse for unauthorised callers), and an admin's removal is SEC-03 audit-log material.
- Out of scope by D-122's wording: a removed responder's unsent stand-down of the walker's EARLIER journey (still their responder there) is not withdrawn, and a later open withdraws only for current responders.

**Recipes (Linux session, about 6 min total):**
- 4.2 MB copy (git ls-files root files + tar apps/server and packages minus .vite/coverage + node_modules symlink); L3 config = the stand-in config with root set to the copy. Control: removal.integration 28/28 in 22 s.
- Node runner with exact-string mutants (assert exactly one match, restore in finally, print the "Tests" summary line). 18 mutants: removal.ts log mutants (journeyId->responderId, a line for refused or unchanged) killed by removal.system; log.ts raw journeyId/code/stage/count/reason and a spread of extra fields killed by log.test; adapter withdrawal narrowed to WITHDRAWN_WHEN_RESET, to unresolved alerts, to the walker as recipient, and the warning to the removed responder all killed at L3 (AC10, AC3, AC13); sms-check not paging on unheard killed by AC15.
- tsx probe of createLog (file dropped into the copy's apps/server/src): 102 hostile writes of the three events, 0 marker hits, key sets exactly event+journeyId+reason, event+stage+code, event+count.
- Column names round and journey_id pass both privacy scan regexes (checked with node).
