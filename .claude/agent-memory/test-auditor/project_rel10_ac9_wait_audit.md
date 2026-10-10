---
name: rel10-ac9-wait-audit
description: REL-10-AC9 follow-up (CANARY_WAIT real-timer tests, 7158b42..1a1e0cd) — PASS; 13 in-memory wait variants, all as expected; the wait handover at worker.ts:454 is unpinned at every level
metadata:
  type: project
---

PASS at 1a1e0cd (2026-10-10). Tests-only plus an `export` and two comments in worker.ts.

- vs main the test diff is purely additive (only the vitest import gains beforeEach); tests:changes "none weakened".
  Within the branch, test 4 dropped its 20 ms pause and `afterAbort == armed - 1` for `afterAbort == before` (exact,
  same kill set), test 2 gained a pending assertion, and test 1's bound moved before the wait (fixes a false red).
- Determinism reasoning for real-timer bounds: Node dates a timer from creation (GetNow updates the loop time); lists
  are run in expiry order, and microtasks run between lists, so a bound started BEFORE the wait and due sooner
  always wins, however long the stall. Verified with 150 ms and 1000 ms busy stalls before and after the wait's timer.
- `process.getActiveResourcesInfo()` 'Timeout' (Node 22.22): one entry per ref'd Timeout object (not per duration
  list), intervals included, unref'd excluded, removed synchronously on clearTimeout and on a timers/promises abort;
  a pre-aborted delay creates none. Sound for synchronous before/after reads. A correct `ref: false` wait fails test 4
  (a loud false red, noted).
- Faults (startVitest + transform, `function` syntax, applied=1 checked): {} -> 2,3,4 fail; () => undefined -> all;
  leak-on-abort (rejects, timer kept) -> only test 4; leak incl. pre-aborted -> 3,4; sync-only aborted check -> 2,4;
  half ms / resolves with a value -> 1; wrong error / swallowed abort / unref'd ignoring signal -> 2,3,4.
- Wiring fault `wait: CANARY_WAIT` -> a wait ignoring its signal at worker.ts:454 survives worker.test.ts 190/190;
  canary.integration runs its task with a never-aborted signal, so L3 does not reach it either. Noted, not blocking
  (the run still ends via run.ts's race; process exits explicitly).
- Red: 7158b42's own tree lacks the export; in-memory replay at 7158b42 gives 4x "CANARY_WAIT is not a function"
  (an import red). The behavioural red is the mutant runs, adequate since no behaviour changed.
- RG-05: local reports/mutation/worker.json source == HEAD, full run (not incremental), 243/2/6, line 121 both
  killed (Stryker attributes "All tests"; command runner). No PR for the branch, check-runs total_count 0, so no CI
  result. ai-review.yml line 111 grants `checks: read`, so the brief's 403 premise is stale.
Related: [[unmutable-wiring]], [[rel10-audit]]
