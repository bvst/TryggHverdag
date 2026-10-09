---
name: lost08-audit
description: LOST-08 "They're safe" + 24-hour end test audit, PASS at 369f6b3; 69 faults (2 expected survivors), RG-02 replay at 515b958, requirements-status stale (should-fix); harness ta-lost08
metadata:
  type: project
---
Audited 2026-10-09 (cloud), branch claude/busy-faraday-40n2zl at 369f6b3, base f4ded6d (== origin/main). Pushed, no PR, check-runs
total_count 0. gate:integrity 5 of 5 with NODE_USE_ENV_PROXY=1 (13 required incl. mutation/traceability).
Harness: scratchpad/ta-lost08/{spec,spec2,rg02,spec-runs,dry}.mjs via ../ta-lost07/harness2.mjs; `node dry.mjs <spec>` counts every
pattern on disk first (D1 needed the function signature as anchor: acknowledge's rule has the same two ifs and comment).
Timings: unit+L6 control 16 s; per L6 mutant 2-8 s; L3 (journeys LOST-08 slice + closure/expiry integration) ~26 s per mutant.
- PASS. 69 faults: 49 unit/L6/fake + 16 adapter + 2 first-row + controls. Killed: close-rule order both ways, both halves (domain and
  fake), closer left out / only closer (A1/A2/F1), boundary D5/F4/F8, resolved-since-read A6/F6/A15/F15, stuck handling X1-X10, sweep
  order W1/W2, SM-05 table (fourth reason, 2h10 expiry, ACTIVE expiry), log sanitisers L1-L6 + closure_ignored naming the responder,
  route 403/409/200 maps + device.id-for-userId, api-process silent log / createClosureService({}), due-read order A5/A5b/A5c/F5*,
  retry none/twice A10/A11/F7, clock_timestamp A8/A9 (µs text + xmin tests exist), no row lock A7.
- Survivors: A3 adapter due read `<=`->`<` (L3 clock moves; equality at µs never seeded; domain/fake boundaries killed; one sweep's
  delay at most) and A13 close end without the LOST_CONTACT guard (unreachable). Stryker: journey.ts:946 `responderIds?.` equivalent.
- RG-02 replay (all changed apps/packages .ts served at 515b958): L6 closure/expiry red at import, alerts.system db-gone red; L3 12 red;
  green at red only L1 ts-expect-error tests, table self-coverage, L2 behaviours (fake ships with tests), AC20 (migrations read from disk:
  replay artifact).
- RG-03: behaviour suite pure append (0 deletions, hunks in header/imports/interface/new helpers/array end); api-process helpers moved
  verbatim; every changed pin has a reason and stays exact. Should-fix: requirements-status.md stale at HEAD (LOST-08 26->27 from
  api-process.test, SEC-07 13->14 from closure.integration's loop-1 describe) -> CI traceability diff step fails.
Related: [[sm10-audit]], [[first-row-reads]], [[shared-suite-rg03-blind]], [[in-memory-mutation]]
