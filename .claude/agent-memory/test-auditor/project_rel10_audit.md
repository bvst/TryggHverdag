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

**Loop 2 delta, PASS at 6c58524 (2026-10-10).** Tests only (4 files, one line removed: worker.test.ts `length >= 1`,
replaced by strictly stronger asserts with an RG-03 reason). Harness ta-rel10/loop2.mjs via ../ta-lost02/harness.mjs
(REV DISK, patterns narrowed to the new tests), bin via bin-spec.mjs + bin-mutant.json. 22 + 4 faults, all as expected:
- R3 killed by both new L6 tests (AC1 held delivery to 330 s, AC3 answers held to 361 s); R3old (old 108 tests only)
  still survives, so the kill is the new tests'. Variants killed: late answer clamped to deadline, deadline +2 s in
  domain, polling stops at opening, answer time one poll early.
- W2 + 5 variants (no NOT_CONFIGURED sentence, always blames CANARY_API_URL, line twice, extra not-running line,
  running sentence) killed by the strengthened test + the 3-row test.each; G6/G8 (reason holds value) killed there too.
- W3 + hash of check URL / slice(1) / raw credential stored, and W7, killed by the new L3 test (runWorkerProcess with a
  fake runner, task run by hand, START 503); W3 still survives the worker unit tests (expected, L3 is the right level).
- B1 ({}), only API URL, URL+"/" all killed by the exact-line toEqual in bin.test.ts; control B0 passes.
- Determinism: L6 new 10/10, worker REL-10 10/10, canary.system shuffled x3 (110/110), L3 new 5/5 + full file 13/13, bin x3.
- Notes left: L3 test takes its URI from `started.at(-1)` (fine while sequential); no PR, check-runs 0, so RG-05 unread.
- git status showed 3 docs files modified mid-audit (main session's progress edits, mtimes before my req:coverage);
  check mtimes against your own commands before calling a dirty tree your doing.
