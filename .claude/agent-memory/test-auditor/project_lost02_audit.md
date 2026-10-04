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
