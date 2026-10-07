---
name: lost07-audit
description: LOST-07 SMS escalation test audit, BLOCK at 4d7f188 (HEAD 37207ce memory only): escalation loop either-path (M2) and break (M1) unheld; shared count behaviour seeds created_at == next_attempt_at (U4/F7); worker.ts:528 both-URLs test missing; requirements-status stale + SEC-02/PRIV-03 in titles
metadata:
  type: project
---
Audited 2026-10-07 (cloud), branch claude/busy-faraday-40n2zl, base e695e8a (== origin/main), spec e4e5bc8/2773362, tests 1ba1123,
code 0b8c3c0, loop-1 tests 6ef6dd0, code 4d7f188. Pushed, no PR, check-runs total_count 0; gate:integrity 3 of 5; gh api 13 contexts
incl. mutation/traceability, code-owner true, bypass [] / never. Harness: scratchpad/ta-lost07/{common,fast,wide,probe,adapter,fake,
extra,probe2,probe3,late,rg02}.mjs via ../ta-lost02/harness.mjs (REV 4d7f188); harness2.mjs adds a per-file fail tally.
- BLOCK B1 (M2): escalation.ts:116 `outcome !== 'skipped'` -> `=== 'held'`: a waiting escalation that THROWS is not stuck, and the
  second loop never sets `failed`, so sweep ok + beat recorded (silent). Spec approach 3.4 "held through the wait, or failed". Same
  hole as LOST-02 A4 on the open; the copy got no test. B2 (M1): `break` after a failed first attempt (module doc "holds up no other",
  LOST-02 A15 twin). Both survive all 452 L6 + L3 escalation file. Probes in ta-lost07/probe-tests.ts.txt pass real, kill both.
- BLOCK B3 (U4/F7): shared behaviour 10 seeds every SMS with createdAt == nextAttemptAt, so counting by next_attempt_at survives
  L3 (adapter) and L2 (fake); only L6 kills the fake's. Retries keep next_attempt_at <= 60 s ahead, so the page would never fire.
  Fix: r5 (retrying NOT_CONFIGURED) nextAttemptAt 40 s ahead; probe2 kills both, passes real.
- Should-fix: requirements-status.md stale at 4d7f188 (CI `git diff --exit-code` step); loop-1 titles "(SEC-02, PRIV-03)" flip two
  uncovered requirements green. worker.ts:528 `||`/`&& true` (Stryker survivors) need a both-valid-different runWorkerProcess test
  (probe3 kills both).
- Killed (~170 in-memory runs): rule order/boundary/missing half, read clauses + late read, lock (none/skip-always/nowait/rowTaken
  early/no decision), clock_timestamp/statement_timestamp (AC17 µs text + xmin), claims both ways, count kind/withdrawn/sent/limit,
  ack withdrawal x5, fake twins, sms-check, /fail, URL rules, log sanitisers, sender breaks, worker wake. Harmless: read early within
  the L3 2 s margin, count `<`, update guards under lock, escalation-before-opens.
- RG-02 replay (tests+prod at 1ba1123): system 18 red + escalation.system import error (exact); unit 140 red + 5 AC20 reading .tf
  from disk = 145 (claimed). RG-04: 2 hand entries == fresh measure (51/51, 18/18). RG-05 reports == HEAD; alerts 291/291.
- Budget: alerts median 4.3 s/mutant, transform 57-72 %, import 19-25 %, tests 4-24 %; not test design.
Related: [[lost06-audit]], [[second-path-isolation]], [[equal-seed-columns]], [[shared-suite-rg03-blind]]

**Loop 2 (2026-10-07, e9f1687; HEAD e9653ce memory only): PASS.** Harness ta-lost07/loop2/{spec,spec2,spec3,spec4,rg02}.mjs via
../harness2.mjs (REV e9f1687). 6 controls survive; every claimed kill confirmed, each by the new test only: M2 (E1) by AC16's
failed-retry test, M1 (E2) by AC15 `first`, U4/U4b/U4c at L3 and F7/F7c at L2 ("expected 2 to be 3"), worker 528 `||`/`true`
by the both-valid test, whole-string compare by the same-UUID test. config C1-C12 and infra I1-I7 killed. RG-02 replay (tests HEAD,
config/worker/.tf at 8998079): 27 red (24/1/2), 193 green, as claimed. RG-03 by hand: two titles, r5 fixture, comment move only.
- Should-fix: E3 `break` after a stuck alert in escalation's WAITING loop (escalation.ts:117) survives L6 + L3; the open's twin
  (watchdog.ts:139, LOST-02, main) too. Not blocking: fires only after stuck.push, so the sweep still fails/pages; loses later
  alerts' retry and overdue lines. Loop 1 never planted it (my miss).
- Notes: C7 (line 133 trailing-slash check) equivalent, generic reason still distinct; C13 `[0-9a-f-]{36}` harmless (pings
  nothing, check pages). REL-07 6 / REL-08 7 include loop-1 comment-only files, no status flip. process.json source==disk:
  183/4/2, 525-540 all killed, 4 survivors on main.

**Loop 3 (2026-10-07, f7928e3; HEAD d4cb152 docs/memory only): PASS.** Harness ta-lost07/loop3/{spec,spec2,spec-main}.mjs via
../harness2.mjs. Every claim confirmed, each kill by the new tests only: E3 and E3b (fail 2 of 75, the two new AC16 tests; 2 of 241
across the four L6 suites), plus reverse order, first-only, last-only, wrong-alert overdue, double push. CHECK_PATH {11,12}/{12,13}
killed by the too-short/too-long cases (and Stryker's {0,12}/{12,}); config.ts:133 false/emptied/startsWith killed ("expected 6
to be 7"). Leak mutants (pathname, value in the general reason) killed 26/28. config.ts: 544 AST leaf tokens identical (skip JSDoc
nodes; the raw ts scanner loses sync on backticks in comments), emit with removeComments identical.
- Should-fix S4: E3c `break` after `escalated += 1` in the WAITING loop survives L6 x4 + L3 escalation: both new tests put the held
  alert first. Mirror order (first let go, second held) kills it. Watchdog twin W8c (break after opened) survives too, on main.
- BUG-28 replayed on MAIN at L6 (SERVE_ALL = git diff --name-only main..HEAD -- apps packages, served from e695e8a): break after
  stuck survives main's 3 L6 alert suites (166); sanity (loop removed) killed 5. BUG-28's lines 137-139 and "four suites" are the
  branch's. Notes: .tf too-long ({12,13}) survives infra.test.mjs; other UUID groups' quantifiers survive config.test.ts (harmless).
