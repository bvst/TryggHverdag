---
name: bug18-db-owned-review
description: BUG-18 / D-105 review 2026-10-04 (PASS at 3fdca02) — adapters/db.ts owned, in the ai-review safety filter, brief line added; open: brief line names db.ts only though sizes and limits are passed at call sites; its SQLSTATE rule is D-108 (LOST-02), not D-068/D-105
metadata:
  type: project
---

Reviewed origin/main(fe384c5)...3fdca02 on fix/BUG-18-db-owned. PASS. No apps/ change at all.

Verified (file-free):
- ai-review.yml: numstat 1/0; js-yaml 4.3.2 parse of workflow and inner filters: safety 26 -> 27 (only
  apps/server/src/adapters/db.ts), ui deep-equal, rest of workflow deep-equal. picomatch 4.0.7 {dot:true}
  matches the literal path exactly, not db.test.ts. safety-reviewer's matrix row is applies: safety.
- CODEOWNERS: last-match emulation (the gate.test.mjs matcher) over 530 tracked paths, base vs head:
  only db.ts changes owners, [] -> [@bvst @urso-agent]. Lines after it (41-79) cannot match it.
- gate:integrity 3 of 5 (the two GitHub API checks cannot run from a session). 206/206 tests in
  gate.test.mjs + ai-review.test.mjs.

Open (check before repeating):
1. Brief line scope: pool sizes are applied at the CALL SITES (api-process.ts:28 POOL_SIZE.api,
   worker.ts:95 POOL_SIZE.worker, adapters/migrations.ts:20 max 1) and no test pins that they pass
   POOL_SIZE (db.test.ts checks only the constants' sum). LOST-02 puts the limit values in
   domain/watchdog.ts and passes them via createPool options from the callers. All callers are in the
   filter and owned, so the review runs, but the brief line names db.ts only. Suggested widening it.
2. The "pool's name and the SQLSTATE only" rule is D-108 on LOST-02's branch; D-068 says only "a chosen
   message, never the error object". Brief cites D-068, D-105. Fix when LOST-02 lands (cite D-108).
3. The line's "does not loosen or remove" presupposes limits and listeners that do not exist until
   LOST-02; for LOST-02's own review there is no baseline. Check there: idle limit + sweep interval
   inside the alert budget, and a listener that carries on leaves the failure loud (D-068's concern).
db.ts is not in SAFETY_PATHS (no mutation run), same as the other L3-only adapters (gate-decisions.mjs
comment lines 27-31). LOST-02 may add L2 tests via fakePostgres; whether it then joins is the owner's.

**How to apply:** on LOST-02's review, check items 1-3 in the brief and that D-105 still precedes D-106 in
decisions.md after main is merged in. Related: [[bug14-gate-files-owned-review]], [[lost01-heartbeat-review]].
