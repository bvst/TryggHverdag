---
name: bug12-audit
description: BUG-12 / D-098 / D-099 test audit (PASS at 6a3d606, re-checked at 5a8028f): 48 in-memory mutants, 4 survivors all backed by a required check; how to replay a test commit against its own production code
metadata:
  type: project
---

Audited 2026-10-02 (cloud session), branch fix/BUG-12-mutation-timeouts at 6a3d606, then 5a8028f (gate.mjs and steps.mjs
pass a step timeout straight through; production only). PASS.

In memory, no repo writes: 41 in-process mutants in gate-decisions.mjs, mutation.mjs, stryker.config.mjs and
api-process.ts, 39 killed, no-op controls survived. Child mutants (spawned mutation.mjs and gate.mjs): refusal removed,
refusal exiting 0, step timeout dropped in gate.mjs or steps.mjs, timeout 0 for other steps: all KILLED.
Survivors, none Blocking because a required check backs each:
- main() wires hasSourceFiles untested (C4: always true passes all 4 D-099 script tests). Backstop: the repository tests
  in gate-decisions.test.mjs (every group path exists path by path, file paths are files, folders end in /). Should fix:
  a scratch-repository case with one group path missing, asserting the output names it.
- hasSourceFiles statSync(at).isFile() for slash-less paths (B7): no table row for a folder named without its /.
  Backstop: "every safety path that is a folder ends in /".
- decideMutation within() folder boundary (E6): over-triggers only, the safe direction.
- --incremental=true refusal spelling (C3): harmless, strykerRunner and the config never ask for incremental.
RG-02 replay, tests at X against code at X: 88ead9b 47 red (the #53 reproduction failed with "expected true to be
false"), 5343159 9, 4c0c405 2, 9f0e201 5, 5f0902b 6 in-process plus 3 D-099 script rows ("a Stryker run started").
Facts: no PR and check-runs total_count 0 on 6a3d606, so RG-05 had no CI result to read (not the 403 case).
reports/mutation/*.json from the fresh 13:22-13:29 run: 265 mutants, 0 timed out, lowest file journeys service.ts 19/21.
The coordinator reported coverage:ratchet failing at 6a3d606 (gate.mjs branches 35.71 to 29.41, steps.mjs 100 to
97.36: branches exercised only in a spawned child). 5a8028f removed those branches; I did not measure it.
Fake PostgreSQL in test-kit: a bug in it can only turn the REL-01 wiring proof red, never green, because the 2031 time
reaches the API only through a now() query (F1/F2/F6 killed). Gaps: Bind result-format codes are not checked; every
column is text, so databaseTime takes its string branch where real pg gives a Date (L3 covers that); a throw in
receive() inside the socket data handler is uncaught and the request hangs until the test timeout.

How to apply: on a later mutation-gate change, re-run the C4 and B7 probes first. If the hasSourceFiles wiring gets a
scratch-repository test, C4 must be killed.

Related: [[mutation-pooled-score]], [[entry-script-wiring]], [[in-memory-mutation]], [[gate-integrity-local]]
