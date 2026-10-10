---
name: rel10-audit
description: REL-10 staging canary audit (880d2ba, PASS) — 68 faults planted in memory, 13 survivors, four should-fixes for test-author's loop 2
metadata:
  type: project
---

PASS at 880d2ba (2026-10-10). Saved by the main session: the brief said not to edit files.

- 68 faults planted in memory (Vite load hook, scratchpad/ta-rel10/; a loader hook for the bin child);
  13 survived. Harness: spec.mjs, probe.ts.txt, probe-spec.mjs, bin-*.mjs, rg02.mjs.
- Four should-fixes, sent to test-author as review loop 2:
  - R3 (run.ts answeredAt = the alert's opening): survived all 108 L6 tests, because at L6 the opening,
    the delivery and the 2 s read share one moment; under it a late answer passes ON_TIME and alertMs
    measures the opening;
  - W2: the half-configured start line checked only by `length >= 1`;
  - W3: registering the hash of the wrong value (apiUrl) survived every worker test;
  - B1: bin's "all three usable" pattern also matches the half-configured line.
- Low-risk survivors left: A6 (adapter's latest-alert order, unreachable with one heartbeat), F5, client
  K3–K7, run R2/R7/R10, Terraform T6 (upper case in the UUID's first group).
- RG-05: no CI mutation result yet at audit time (no PR, check-runs 0); local reports matched HEAD.
