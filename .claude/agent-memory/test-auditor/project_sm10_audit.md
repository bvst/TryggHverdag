---
name: sm10-audit
description: SM-10 responder removal test audit, BLOCK at 3da9517 (HEAD a77c762 docs only): the reset's read of "the journey's unresolved alert" survives every test without its unresolved filter (A-R1); 73 faults, harness ta-sm10
metadata:
  type: project
---
Audited 2026-10-09 (cloud), branch claude/busy-faraday-40n2zl, base 689a0b5 (== origin/main). Harness scratchpad/ta-sm10/{base,spec0,spec1,
spec2,spec3,rg02}.mjs via ../ta-lost07/harness2.mjs (REV 'DISK'); L3 on PG16 stand-in 55432 (ta-lost02/vitest.l3.config.mjs), runs: l2 3 s,
l6all 5 s, L3 SM-10 slice 29 s. Probe test text in ta-sm10/probe-r1.ts.txt (appended in memory to removal.integration.test.ts).
- BLOCK A-R1: adapters/journeys.ts removeInside, `.where(and(eq(alerts.journeyId, locked.id), unresolved(alerts.state)))` -> drop the
  unresolved filter survives all L3 (56). With an earlier RESOLVED alert on the journey, [first] picks it, the domain says unchanged, and the
  current alert stays ACKNOWLEDGED by a removed responder: no SMS ever. Probe (contact back, reopen, R1 acks, remove R1) passes real, kills it.
  Fake twin F-R1 dies only because the fake's own copy of the rule resets a RESOLVED alert. AC8 property cannot reach a second alert at L3
  (database time does not pass). Fix: shared behaviour with a resolved alert seeded first.
- Should-fix: A-W5/F-W5 removal re-withdraws already-withdrawn rows (isNull(withdrawnAt) unheld both sides); F-U2 fake unheard count OPEN-only
  survives L2+L6 (adapter held only by escalation.integration's non-shared test: D-100 gap); A-E3 stand-down round unheld (harmless).
- Killed: reset fields/withdrawal x8, round in SMS/notice/warning inserts, removal withdrawal kinds/recipient/journey/sent, warning
  last/due/recipient, clock_timestamp/statement_timestamp (AC19 xmin + text), no row lock, no lock_timeout (AC18 'still waiting'), escalation
  skip, due-read exists, unheard filters (adapter), module log lines incl. responderId in removal_ignored, SMS check x6, start lines x5,
  privacy 409 pre-check (ACK-1), stryker command pins B1-B6.
- BUG-41/D-124 judged sound: Vitest 5 fs cache key = sha1(id abs path + source + env hash incl. config/plugins), atomicWriteFile
  (tmp+rename); only Killed counts in the gate, so timeouts cannot inflate. nocache vs fscache1 reports 1,170/1,170 same status (re-ran
  compare-reports.cjs). Local reports' sources == HEAD.
- RG-02 replay (rg02.mjs, all apps/packages at 322c7a4): 57 of 63 unit SM-10 red, L6 alerts.system AC15 green at red (the fake was
  already changed in the test commit; watchdog module unchanged), fine.
- gate:integrity 5 of 5 with NODE_USE_ENV_PROXY=1 (first time); pushed, no PR, check-runs total_count 0.
Related: [[lost07-audit]], [[equal-seed-columns]], [[first-row-reads]]
