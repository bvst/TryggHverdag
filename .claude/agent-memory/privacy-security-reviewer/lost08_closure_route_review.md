---
name: lost08-closure-route-review
description: LOST-08 ("They're safe" route, 24-hour end) — fourth task in a row where module-level oracle mutants on a one-404 route survived ALL L6 and L3 because strangers are only tested against one alert state; scratch killing test recipe; 17-mutant runner; log probe; 403-to-a-fellow-responder reasoning
metadata:
  type: feedback
---

First seen on LOST-08 (2026-10-09, HEAD e1891fa, base f4ded6d). Verdict PASS, one should-fix (test gap), notes otherwise.

**Why:** the shipped code was right under every probe (the domain close rule checks "responder of the journey" first, and closure.ts adds no pre-check). But the end-to-end stranger test (closure.system AC2) sends W, a user of another journey and another walker ONLY at an ACKNOWLEDGED alert, and the removed-acknowledger test (AC3) only at an alert reset to OPEN. Three module pre-checks inserted after `alertForClosure` in modules/alerts/closure.ts SURVIVED all 638 L6 tests (every *.system.test.ts) and 64 L3 tests (closure, removal, acknowledgement integration):
- O1 `alert?.state === 'RESOLVED'` -> ignored ALERT_RESOLVED (strangers get 409 + a closure_ignored line);
- O3 `RESOLVED && acknowledgedBy === responderId` -> 409 (removed acknowledger, SM-10 pattern);
- O5 `RESOLVED && acknowledgedBy !== responderId` -> 409.
A scratch L6 test killed all three and passed on shipped code: (1) A acknowledged by R1 and resolved by contact back / by R1's close; W, a user of another journey, another walker each get the unknown ID's 404 byte-for-byte; no closure line. (2) R1 acks, contact back (A RESOLVED, acknowledged_by R1, J ACTIVE), R1 removed via w.remove; R1's close equals the unknown ID's 404; no line. Helpers in closure.system.test.ts: world(), acknowledged(w, n), w.seed, w.walker(), w.responder(), w.heartbeat, w.close, w.remove, w.closureLines(), syntheticUuid().
O2 (403 pre-check on OPEN/ESCALATED) and O4 (403 on ACKNOWLEDGED) were KILLED.

**How to apply:** this is now the standing first check for any route with a "one 404 for not-found and not-yours" answer (LOST-06, LOST-07, SM-10, LOST-08 all missed it). Grep the 404 tests, list which alert STATES and HISTORIES each stranger kind meets, and run the pre-check mutants per state. M3's read routes will need the same.

**Other facts confirmed:**
- The 403 NOT_THE_ACKNOWLEDGER goes only to current responders of the journey (rule step 1 first). Same body for OPEN, ESCALATED and acknowledged-by-another, so a fellow responder learns nothing they did not already get by push (the LOST_CONTACT push and the ACKNOWLEDGED notice). Accepted as D-126 argues. 409 after the journey ended tells a responder only "over", which the stand-down already told them (PRIV-03 marginal, same as LOST-06).
- Closer kept as acknowledged_by (no new column); README "Open for M4" note was in the docs commit (second time in a row it was present).
- PushMessage unchanged; AC1 pins exactly messageId, recipientId, kind. There is still no real push adapter (M3).
- Migration 0008: snapshot diff = 3 enum value lists only. No package.json/lockfile/workspace change.
- openapi.json vs main: 0 removed, 0 changed, 119 added keys, all under /paths/.
- RG-07 scan of 10,985 added .ts/.mjs lines: no literal UUID, coordinate, phone or email.
- 24-hour end improves PRIV-04: LOST_CONTACT journeys previously never ended unless the walker did, so retention (counted from the end) never started.

**Recipes (Linux session, about 4 min of runs):**
- 4.7 MB copy (git ls-files root files + tar apps/server, packages minus .vite/coverage/.vitest + root node_modules symlink); L3 config = stand-in config with root sed'ed to the copy. Controls: closure.system 58/58, closure.integration 20/20 on 127.0.0.1:55432.
- `pss-lost08/tools/mutate.cjs <scratchdir> [ids]`: env L6=comma list of L6 files, or L3=comma list of integration files (runs from the copy root with the copy L3 config). 17 mutants: O1-O5 oracles, M1 a line for every refusal, L1-L9 log.ts raw/spread mutants (all killed by log.test AC18), L10 error message as code, L11 responderId in the alertId slot (both killed by closure.system).
- tsx log probe (file in copy apps/server/src, deleted after): 210 hostile writes over the four events, 0 leaks; the only hits were a UUID-shaped marker accepted in the alertId slot (by design: any canonical UUID passes uuidOf, so a user ID in that slot is caught only by tests like L11, not by log.ts).
- TMPDIR /tmp/claude-0/l08t was already a symlink to scratchpad/tmp-lost08; no .vitest left behind.

Related: [[lost06-acknowledgement-route-review]], [[lost07-sms-escalation-review]], [[sm10-responder-removal-review]], [[reviewer-sandbox-quirks]]
