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
