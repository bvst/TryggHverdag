---
name: lost02-audit
description: LOST-02 lost-contact alert test audit (BLOCK at 6f27b80; HEAD 4a2f128 docs/memory only): RG-01..04 hold, RG-02 replay clean, 110 in-memory faults (L6, in-process, L3 on PG16 stand-in, fake, tsc), 2 Blocking survivors in modules/alerts/watchdog.ts
metadata:
  type: project
---

Audited 2026-10-04 (cloud), branch claude/busy-faraday-40n2zl, tests cd0ba45, code 6f27b80, base origin/main 7e05c8e. HEAD moved to
e36a384 (requirements-status regenerated) then 4a2f128 (reviewers' memory) mid-audit. No PR; check-runs total_count 0.

- BLOCK for two spec'd watchdog clauses no test holds at any level (L6, worker, L3):
  A4 `outcome !== 'skipped'` -> `=== 'held'` in the waiting-attempt loop: a waiting attempt that THROWS is not stuck, sweep ok, beat
  recorded (AC19 "an open fails -> no beat"; approach 6 "in either attempt"). A15 `break` after a failed first attempt: other journeys
  in the sweep never opened (approach 3.3 "holds up no other"). Probe tests appended in memory to alerts.system.test.ts (beforeNext x2 +
  failWith/recover; silence UNDER_STUCK for A15) pass on real code and kill both: scratchpad ta-lost02/probe-tests.ts.txt.
- Should fix: W1/W2 (stop() with sweep idle, or a sweep opening during stop: runNow has no stopping guard; only the delivery timer is
  tested); J3 waiting attempt's set_config(..., false) leaks a session lock_timeout (L3 survives); D8 dedupe keyed per pool (only first
  lost connection logged); D-100: shared AC15 "never handed out again" checked inside the 30 s lease on a still clock (F13 fake survives
  the suite, J1 adapter caught only by AC16 L3), and "keeps first sent time" is fake-only (F11 killed, J10 adapter survives).
- Notes: domain-filter survivors (Stryker's 2): true for any honest store (A21/A22 survive, A23 needs read+filter+open all lowered),
  killable only by a contract-breaking stub; fake answers `held` for a held row no longer matching, PG returns no row in 1 ms (probed),
  fake stricter; T2 watchdog_overdue+latitude survives tsc (per-field @ts-expect-error); fake-postgres.test.ts now counts toward
  LOST-02's row via describe "(LOST-02)" without fixtures-only marker; worker.test minute-task exact sequences relaxed to sorted/at(-1)
  (no fault escapes; reason implicit).
- RG-02: replay via harness load hook, prod at cd0ba45: absent new modules -> file errors; inert stubs -> every LOST-02 L6 test red,
  only capture controls pass; AC24/25 via in-memory test rewrite to a scratch copy of the old rules (REPO_ROOT pinned): 92 red, 47
  controls green; L3 needs the base migrations folder too (mig-base via git archive; MIGRATIONS consts rewritten) else AC23/AC13 pass.
- RG-05: local reports == 6f27b80 byte for byte; watchdog 85/87, outbox 37/38, domain/watchdog 12/12, worker 129/138 (+2 timeouts).
- Harness: scratchpad/ta-lost02/harness.mjs <abs spec.mjs> [id-prefix...]; spec exports REV, RUNS, MUTANTS {files: {path: edits|string}},
  SERVE_ALL, PASS_RE. Counts v.state.getUnhandledErrors() (D9 `client.once` only dies as an unhandled error). L3 config
  ta-lost02/vitest.l3.config.mjs (PG16 on 55432, fresh db per start; ~25 s per L3 run).
Related: [[lost01-audit]], [[in-memory-mutation]], [[second-path-isolation]]

## Loop 1 re-audit (2026-10-04, PASS at 3539d4f)
- B1 (AC19, waiting attempt that throws is stuck) and B2 (AC12, one failure holds up no other) closed: A4 and A15 killed at L6; B2 also at L3 by 1b.
- Should-fix: 1a's "worker connection's lock_timeout still 0 afterwards" is vacuous — the open fails and the rollback undoes even a session-level set_config. J3b (first attempt session-level only) survives; fix = a committed first-attempt open on a max-1 pool, then lockTimeoutOf(single) === '0'.
- Survivors (notes): K11/P1 stop does not await the read-back; P2 read-back stdout vs stderr (captured() merges); R12 missing pg_settings row reads "in force"; R5 digits regex unanchored; JN2/JN3 progress.rowTaken untested; J11 claim without skip locked; I8 `.*/node_modules/` branch of OUTSIDE_NODE_MODULES.
- J4 (no lock limit at all) hangs L3 (holder and waiter deadlock, 180 s hook timeouts) rather than failing — a kill, but CI would show a timeout.
- RG-02: 6cdf7d5 vs bb96877 → 53 red unit/imports/system (45 AC24, 6 read-back, 2 cancelled message), L3 3 red (1a, 1b, AC23). RG-03 for 8fd8466 accepted (BUG-12 health test skips pg_settings; loop-name errors without the names).
- 8fd8466 (a test commit) also deleted 0003_left_lyja.sql while _journal.json still named it — intermediate commit broken; squash-only merging makes it moot.
- RG-05 at b1dbfa4: watchdog 87/87, outbox 37/38, worker 140/146 (+2 timeouts), api-process 16/16, domain/watchdog 12/12, healthchecks 55/55.
- 145 faults total, each run with a passing unmutated control.

## Loop 2 delta re-audit (2026-10-04, PASS at 25f5ccf; HEAD moved to 637b5cd, docs/memory only)
- 53 faults planted in memory (specs ta-lost02/loop2-{unit,unit2,l3,filter,idle,entry,replay}.mjs): every loop-1 survivor now killed by
  its loop-2 test: J3b/J3c/J3 (11a, '5s'/'300ms'), K11 no-wait and pool-ended-first (12a api+worker), P2 (12b), R12/R12b (12c), R5
  four anchor variants (12d), U1-U4 incl. pre-fix lookup (12e), JN2/JN3/JN4 (13a), J11 + nowait (14a), I8/I8c/I8d (16a), V1-V8 bar V3.
- Survivors: F2/V3 `Number.isInteger` dropped (fake and adapter): 0.5 is refused by `>= 1`, no value isolates "whole number". PG rounds
  half-even (0.5 -> 0 = no limit, 1.5 -> 2ms), so harmless; should-fix = add 1.5. I8b root `node_modules/` alternative: near-equivalent
  (pnpm isolated + resolved symlinks never give a flat root path). Worker 12b bin shape regex misses `{ ..., write }` and `write(t) {}`.
- api-process stderr filter: T2 (swallow every chunk) leaves all 44 green and LK1 leak still killed => every stderr assertion sits above it.
- 12a idle second connection is necessary for the API (without it no-wait and pool-ended-first both survive: pg Pool.end() waits for
  checked-out clients, closes idle ones at once); in the worker test the recordingRunner 'pool ended' marker already catches it.
- RG-02 replay vs 179b911 code: exactly 7 red (12e constructor/toString/__proto__ x api,worker: old line echoed "10000constructor";
  15a L3: lockWaitMs 0 opened), 21 green.
- RG-05 local reports == 25f5ccf sources; mutated sources unchanged since b1dbfa4. Worker timeouts #86 170:15 `again = false`->true and
  #97 187:15 `if (again)`->true (endless re-run by construction); loop-1 report overwritten, so identity unverified by artifact.
  Delta's code (adapters/db.ts, adapters/journeys.ts) is in no mutation run.
- Harness trap: Vitest truncates `test.each('$name')` titles to ~40 chars ("LOST-02-AC20: an open given a lockWaitM…"); a -t pattern on the
  full name matches nothing (fail 0 pass 0 looks like a survivor). Use the truncated prefix; check pass > 0 in a control.
