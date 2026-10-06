---
name: lost03-audit
description: LOST-03 back-in-contact + "I'm home" test audit, PASS at 3471859 (HEAD moved to c6ebc71, reviewers' memory only); RG-02 replay clean; 79 in-memory faults, 66 killed, 1 real survivor (home journeyId lower-casing unpinned)
metadata:
  type: project
---
Audited 2026-10-06 (cloud), branch claude/busy-faraday-40n2zl, tests 2bbf05c (== HEAD's), code 6add162, base origin/main 5cd5d24.
No PR; check-runs total_count 0 on 3471859 and c6ebc71. gate:integrity 3 of 5 (no rules token); gh api: 13 contexts incl.
mutation/traceability, code-owner review true, bypass [] / never. PASS.

- RG-01: AC1..AC20 all in real test titles (AC1 via test.each %i). Only LOST-03 and SM-04 changed colour in requirements-status.
- RG-02 (scratchpad/ta-lost03/rg02.mjs via ../ta-lost02/harness.mjs; prod from 6968af8, base migrations via git archive, base
  openapi.json): unit+system 110 red / 722 green, L3 42 red / 143 green. Reds name the missing event ("no rule for an event of
  type contact/home"), log event, route (404), column, recordHome, or the module not mapping back_in_contact (500). Greens by
  design: the fake's own behaviours (test-kit is in the test commit), L1 type tests at run time (tsc: 21 diagnostics in
  log.test.ts with a base-shaped LogEvent), AC18 path-item sha pins, AC8 hold-bound pins, "nothing changes" cases that held
  before (stale heartbeat, duplicate, heartbeat-first row order), AC20 index pin. **L3 AC5 property passed at base**: 15 runs,
  margin 2 s filters the threshold constants; offline fc model says it catches a never-back adapter ~66 % of runs (100 runs,
  margin 0: 100 %). Deterministic L3 behaviours carry the kill. Note.
- RG-03: every removed line in an existing test is on the spec's list with a reason beside it; none weakened. LOST-01-AC8 stale
  variant keeps every assertion, at exactly 5:00 (kills F6 `<=`). LOST-02-AC2 -> step-by-step property, strictly stronger.
  migrateThrough0003 mirrors migrateDatabase call for call. LOST-02-AC5 lost only its heartbeat call.
- RG-04: baseline byte-identical to main; ratchetDrops vs main's baseline over 10 changed files: []; floors hold. home.ts
  100/100 has no entry (not locked in; LOST-02's watchdog/outbox neither). Note.
- RG-05: local reports == HEAD sources; journey.ts 134/135, service.ts 121/122 (both survivors pre-existing code), journeys run
  command holds both system files.
- Faults (faults.mjs, faults2.mjs, tsc-lost03.mjs): adapter 36 at L3 (28 killed), fake 13 (11), api 4/4, log 10/10, contract 9
  (6), tsc 7/7. Lock-order faults all killed (heartbeat/home without for update; home taking the alert row first deadlocks in
  the forced-order AC17 test). Survivors: equivalent A5 kind clause (until task 6's SMS kind), A6, A9/F4 attempts>=1, A12, B4b
  (silence from receivedAt: a LOST_CONTACT journey's last contact is always >= 5 min old, so only this heartbeat can bring it
  back), B6/B16 state guards under the lock, K4 params strict; near-equivalent A10/F5 hold's `next_attempt_at > now()` (stand-down
  stamped with a past due time, still due at once; no case isolates it); REAL K5 `.toLowerCase()` on /home's journeyId
  (heartbeat route pins its own at L6 and contract level). Should fix, not blocking: regression only nulls journeyId in
  home_ignored/alert_missing lines.
Related: [[lost02-audit]], [[in-memory-mutation]], [[isolating-values]], [[baseline-vs-main]]

**Loop 1 re-audit (2026-10-06, cloud), PASS at 2aa23f4** (HEAD moved to 386ad80/39e838f: reviewers' memory only). Tests 58b37c9,
code 2aa23f4, spec 6731463/f75ba38. No PR, check-runs total_count 0; gate:integrity 3 of 5; gh api: 13 contexts, bypass [] never.
Harness: scratchpad/ta-lost03/loop1/{faults-l1,rg02-l1,probe-d100}.mjs via ../ta-lost02/harness.mjs, REV pinned to 2aa23f4.
- Faults (52, controls 67 L3 + 453 fast green): every loop-1 test kills its fault. Withdrawal in openInside W1/W2/W4/W6/W7 (moved
  before the lock check)/W8 (Proxy routing update(outbox) to db = outside the tx) killed by 1b/1c; fake FW1 kills 1a at L6 with
  "A1's BACK_IN_CONTACT after A2's LOST_CONTACT". recordHome H1/H1d/H2/H5/H7/H8 killed by 2a. C1 and C2 (even plain
  console.error(error.cause)) killed by 4a only. K5 now killed by 7a and 7b. A10/F5 killed by 9a. M1/M2 by 11a. P1 (never back)
  killed at run 1 by the fixed example; without it 4/6, old shape 4/6.
- Survivors: W3 kind clause (fake-only test pins FW3; equivalent in reachable states), W5/FW5 not-yet-withdrawn (re-stamp only),
  H3 refusal falling through (backstop: journeys_ended_at_end_reason_check), H4 equivalent, A12 near-equivalent.
  **H1w real (should fix):** 2a's "another walker" uses the stranger's own device, so the device check refuses anyway; the walker
  clause under the lock is pinned only for the fake (FH1 killed by the fake's own message regex).
  **D-100 (should fix):** fake recordHome lower-cases walker/device (asStored), adapter hands them to the domain (exact compare):
  probe gave fake 'home', adapter rejects; the fake's own test pins the fake's side. Unreachable via the module.
- RG-02 at 58b37c9 prod: unit 0 red (fake/domain/contract pins), system 18 red (all: service passes a bare ID to the new
  recordHome, 500), L3 7 red (1b/1c on the missing withdrawal; 2a/AC16/AC4/14/15 on the interface). 1a green at base by design.
- RG-03: all on the spec's list except the fake no-clock test's ended->already_ended (reason written beside it, item 3). Note.
- RG-04: 3 entries added, equal to coverage/coverage-summary.json (11:22, after HEAD); nothing else moved vs main.
- RG-05: local reports == 2aa23f4 sources; service 122/123, journey 134/135, min worker.ts 140/146 (95.9 %, Timeouts not counted).
