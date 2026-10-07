---
name: lost06-audit
description: LOST-06 "I'm on it" test audit, PASS at 5d62a0a (HEAD 47510e7 docs/memory only); 101 in-memory fault runs, every reachable fault killed; 2 should-fix (guard test bare toThrow; clock/AR-05 faults killed only by a ms-floor equality)
metadata:
  type: project
---
Audited 2026-10-07 (cloud), branch claude/busy-faraday-40n2zl, spec 91acb06, tests 0809bb0, code 05f054a, loop-1 tests 5d62a0a; base
origin/main 57502b8. Pushed, no PR, check-runs total_count 0; gate:integrity 3 of 5; gh api: 13 contexts incl. mutation/traceability,
bypass [] / never. PASS.
- Harness: scratchpad/ta-lost06/{common,faults,batch2..5,rg02}.mjs via ../ta-lost02/harness.mjs (REV 5d62a0a). L3 on PG16 stand-in
  ~15 s per mutant; L6 acknowledgement.system ~1 s; whole L3 set at HEAD 234/234 green in 63 s.
- Faults: module read-first (M1/M2/M2b/M2c via store.calls tests), privacy oracle pre-checks M3/M3b (loop-1 stranger tests),
  lines, stage, rethrow, store-decision mapping, api, contract, log, process wiring: all killed. Adapter: no for update / share /
  skip locked / nowait / alert-row lock (J13 killed ONLY by AC3 L3 pg_stat_activity), stale pre-lock read, kind clause, hold
  min/old left join/no `> now()`, notices to acknowledger/any journey, resolution clearing who, acknowledger not stood down: killed.
  Fake: hold first/last (each killed by one of AC8's two orders), kinds, wait, order, case, notices, times: killed at L2.
- Survivors: equivalent J3/J3b (update guards under the lock), J12 (inner vs left join), FK1c (reduce seeded with now makes `> now`
  redundant); near-equivalent J11/FK1d attempts>=1 (pre-existing). Level-only: C1 lower-casing (L2 contract only), FK1b/FK4/FK10
  (L2 shared suite only: the module answers refusals from the read, so L6 never reaches those fake paths).
- Should-fix 1: journey.test.ts AC14 unlisted-event test uses bare toThrow on 'escalate'; its comment claims the controls make the
  throw "the rule's own" but a TypeError passes. Stryker's 3 survivors at journey.ts:449-450 (hasOwn guard) die to a probe that asserts
  /no rule for an event of type/ and uses 'constructor'/'toString' (guard removed returns a VALUE for those).
- Should-fix 2: acknowledged_at app clock / statement_timestamp / clock_timestamp, and notices via db.execute (outside the tx, AR-05)
  survive AC9's now() bracket and AC11's trigger; killed only by shared AC2's ms-floor equality (gaps 2-10 ms here, 15/15). Fix: µs text
  equality (acknowledged_at::text vs notices' created_at/next_attempt_at) and xmin equality.
- RG-02 replay (0809bb0 tests, 9800fa0 prod): 66 unit red (36 dom, 12 log, 14 con incl. home.test, 2 scripts, 2 proc), kit green,
  L6/L3 files fail at import, journeys L3 LOST-06 12 red/4 green. Test commit made after green phase (39 s before code).
- RG-03: shared suite diff = import lines only; all else on the spec list. RG-04: 2 entries = measured. RG-05: reports == HEAD.
Related: [[lost03-audit]], [[time-equality-kills]], [[in-memory-mutation]]

**Loop 2 delta (2026-10-07, PASS at 07d9d0e, test-only).** Only the AC14 test changed (bare toThrow -> whole-message regex over
escalate + 5 Object.prototype names, reason beside it); the rest is added. Harness ta-lost06/loop2.mjs (REV 07d9d0e; old-file variants
serve 5d62a0a's test via git show). 23 runs: controls green (L3 file 3x, AC9/AC11/AC3-lock 10x more); G1-G5 guard faults killed by
AC14 alone; F1-F6 (new Date, statement_timestamp, clock_timestamp, db-for-tx, notice created_at/next_attempt_at off now()) killed
by AC9 and AC11's µs text checks, F4 by AC11's xmin check alone; O3 (resolved-with-nobody pre-check) killed by the new L6 test and the
L3 lock test, survives both old files; O6 (strangers at non-OPEN alerts via the lock) killed only by the L3 lock test's new rows.
xmin: raw xmin is kept since 9.4 and no savepoint is used, so it is stable on PG15; a future nested tx.transaction would make it a loud
false red. Local domain report 176/177 (line 320, LOST-01's own bare toThrow).
