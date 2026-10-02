---
name: bug10-journey-safety-paths-review
description: BUG-10 review 2026-10-02 (PASS, 82c7a63) — six journey files owned and safety-reviewed; still outside: adapters/clock.ts (every list) and api.ts (owner approval); weak REL-01 L3 clock test; mutation config changes skip CI mutation
metadata:
  type: project
---

BUG-10 (D-092, D-094 to D-096) on fix/BUG-10-journey-safety-paths, reviewed at 82c7a63: PASS.
Verified: CODEOWNERS last match for all 12 tracked files (no wildcard lines, so prefix emulation is exact);
journeys mutation group really runs (Stryker, 4 runners: 21 mutants, 19 killed, 0 timeout, survivors
service.ts:42 `type: 'start'` and :62 `type: 'refused'`, both equivalent today); modules/** clock-free with
the real eslint config via `--stdin --stdin-filename`.

Open should-fixes, check before repeating:
- `apps/server/src/adapters/clock.ts` (databaseClock, used by api-process.ts and worker.ts) is in NO list:
  not CODEOWNERS, not ai-review safety filter, not SAFETY_PATHS. Its L3 test "REL-01: the time comes from
  the database, not from this process" (database.integration.test.ts:64) accepts `new Date()` (60 s
  tolerance vs Date.now()), so a process clock passes every test. Suggested test: inside one transaction,
  select now(), pause, databaseClock(tx).now() must equal it exactly. Needs an owner decision; before LOST-02.
- `apps/server/src/api.ts` holds fromKnownDevice (the 401 decision) and walkerId from the device: only the
  ai-review filter lists it; no owner approval, no mutation, though its tests are L6 in-process. From LOST-01
  that middleware guards heartbeats (a forged "I'm fine" hides silence).
- gate-decisions.mjs:29 says DB files "are mutated by D-036's nightly run": no nightly workflow exists
  (only daily-status.yml is scheduled).
- decideMutation only looks at SAFETY_PATHS, so a PR changing stryker.config.mjs / MUTATION_GROUPS / a
  group's vitest config never runs mutation in CI (BUG-10's own PR skipped). Suggested for BUG-12.

**Why:** these are the remaining places a REL-01 or SEC-07 guarantee changes with less than owner + safety
review. **How to apply:** on LOST-01/LOST-02/BUG-12 reviews, check whether these landed first.
Related: [[mutation-gate-skips-test-only-changes]], [[reviewer-sandbox-limits]].

**2026-10-02 (BUG-12):** the config-only skip is closed by D-098. adapters/clock.ts is now in CODEOWNERS (line 31) but still not in SAFETY_PATHS; with test-kit's fake PostgreSQL it could be mutated in-process (api-process.test.ts reaches databaseClock). gate-decisions.mjs now says the nightly run "does not exist yet" — honest.
