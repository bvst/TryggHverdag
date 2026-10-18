---
name: bug28-audit
description: BUG-28 (watchdog waiting loop, two journeys past 5 min 30 s) test-only audit, PASS at 7a58b33/cbf9896; 12 in-memory faults; AC20 "never lets go" beforeAt gap is closed elsewhere
metadata:
  type: project
---
Audited 2026-10-18 (cloud), branch claude/busy-faraday-40n2zl, base 1151d18 (== origin/main), code commit 7a58b33, HEAD cbf9896
(docs). Three `BUG-28:` L6 tests in alerts.system.test.ts, purely additive (one header-comment line extended). No PR yet, check-runs
total_count 0; NODE_USE_ENV_PROXY=1 gate:integrity 5 of 5, 13 required incl. mutation/traceability. tests:changes clean;
req:coverage left the report unchanged.
- decideMutation on this diff says "running" (alerts.system.test.ts is a mutation input, D-098): the old "test-only edits skip
  mutation" gap ([[safety-test-gate-gaps]]) no longer holds for the alert L6 suites.
- Harness: scratchpad/ta-bug28/{spec,spec2}.mjs via ../ta-lost07/harness2.mjs (REV HEAD). Heredoc into the scratchpad was NOT
  blocked this time; no Write tool in this session.
- New tests: A (break after stuck.push) killed by tests 1+3; B (break after opened) by test 2 only; C slice(0,1), D reversed loop,
  F break in first loop, G slice(1) by all 3; E (only first stuck logged) by test 3. Fake reading `stored` reversed (FK) fails all 3
  loudly: the order pin is real. Old suite (755 L6, BUG-28 excluded) and vitest unit (4020) let A, B, C, E all through.
- AC20 "held by a session that never lets go" (line ~1094): beforeAt == START and no clock advance, so a failed sweep that records
  a beat survives it alone (X-never). Killed by AC20 J-held (line 999, clock advanced), AC20 open-fails, AC19 waiting-attempt-fails,
  AC12 x2, SM-10-AC15, and BUG-28 tests 1-3 (toBeNull). Gap closed elsewhere: note, not a fix for this PR.
- Pattern: wait-loop faults are order-dependent; a two-item test per order is needed (break-after-X only dies when X is first).
Related: [[lost07-audit]], [[second-path-isolation]]

**Loop 1 (2026-10-18, d907018): PASS.** Tests 4 (skipped then held) and 5 (failed then held), plus a comment in test 3 (itself new
vs main). tests:changes clean, req:coverage unchanged, check-runs 0 (no PR). Harness ta-bug28/spec3.mjs. S (else-break after
skipped) killed by test 4 only; F (break after failed) by test 5 only; both survive the other 758 L6. H (`=== 'held'`) killed by
test 5. Test 5 scoping proven by faulting the fake: recover() no-op -> 4 log lines, failWith() no-op -> 2; beforeNext runs at call
time and the loop awaits call 3 before call 4, so only call 3 fails. Test 4's five-request pin is sequential awaits in the fake
(holderAction awaited inside call 3's work, no timers); 10/10 repeat runs green.
- Pattern: for "each is waited for" claims, enumerate every outcome of the per-item attempt (opened/skipped/held/failed) and plant
  a break after each; loop 0 covered only held and opened.
