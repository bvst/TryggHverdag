---
name: bug18-db-owned-review
description: BUG-18 / D-105 review 2026-10-04 — PASS at 3fdca02, loop 1 PASS at 25589a5 (db.ts + worker-heartbeats.ts owned, in filter, brief bullets); both loop-0 should-fixes closed; open notes for LOST-02
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

**Loop 1 (25589a5), PASS.** Loop-0 items 1 and 2 CLOSED: the brief line names the createPool callers
(api-process.ts, worker.ts, adapters/migrations.ts; all three in the filter and owned) and the logging rule is
D-068's own ("never the error object", "never make the failure quiet"). D-105 amended (owner 2026-10-04):
adapters/worker-heartbeats.ts joins CODEOWNERS, OWNER_APPROVAL_PATHS, filter and brief.
Verified: ai-review.yml numstat 2/0, safety 26 -> 28 (db.ts, worker-heartbeats.ts only), ui and rest
deep-equal. Last-match with git's OWN matcher (`git ls-files -c -i -x <pattern>` per CODEOWNERS line, highest
line wins) over 532 tracked files: only those two change owners, [] -> [@bvst @urso-agent]. 210/210 in
gate.test.mjs + ai-review.test.mjs. gh api: ruleset active, bypass_actors [], code-owner review true, 13 checks.
LOST-02's design is on origin/claude/busy-faraday-40n2zl (da808ef): D-107 (10 s sweep), D-108 (own outbox,
watchdog feeds the beat, idle_in_transaction 10 s both pools, lock_timeout 5 s API only, listeners log pool
name + SQLSTATE and carry on); spec item 6: the minute cron pings Healthchecks.io only when lastBeat is at most
30 s old (BEAT_FRESH_MS), so lastBeat then decides Healthchecks.io too.
Open notes (check on LOST-02 before repeating):
4. worker-heartbeats bullet: today the Healthchecks.io link is that record() REJECTS when it wrote nothing
   (worker.ts:48-53 pings after record resolves); the bullet says "records the time it was given" only.
   Suggested adding "and record rejects when it wrote nothing". No L3 test pins a rejection.
5. modules/health/service.ts (turns lastBeat into /v1/health's answer) is unowned and not in the filter;
   WORKER_STALE_AFTER_MS in packages/contracts is in the filter but unowned (only released/ owned).
   privacy-security-reviewer raised the same as a Note. Owner's call.
6. progress.md BUG-18 row names db.ts only; fix when the merge is recorded.
7. LOST-02's limit values live in domain/watchdog.ts (owned, filter, SAFETY_PATHS) — not named in the brief
   line but reached through domain/**.

**Loop 2 (06fc91c), PASS.** Open note 5 CLOSED for modules/health/: D-105 second amendment (0136951, owner)
adds /apps/server/src/modules/health/ to CODEOWNERS, OWNER_APPROVAL_PATHS, the safety filter
(apps/server/src/modules/health/**) and the brief. WORKER_STALE_AFTER_MS (contracts) kept out by the owner.
Verified: ai-review.yml vs origin/main (fe384c5, = merge base) numstat 3/0 two- and three-dot; js-yaml parse:
safety 26 -> 29, only db.ts, worker-heartbeats.ts, modules/health/**; order of the rest kept; ui and rest of the
workflow deep-equal. picomatch {dot:true}: health/** matches service.ts only (one tracked file). Last-match with
git ls-files -c -i -x per CODEOWNERS line, 533 tracked files: exactly those three files change owners,
[] -> [@bvst @urso-agent]. 212/212 in gate.test.mjs + ai-review.test.mjs. No apps/ or mutation-gate file changed.
Brief bullet matches service.ts (clock.now() and heartbeats.lastBeat() passed as nowMs / lastBeatMs, null kept
as null) and api-process.ts:32-34 (databaseClock(db), databaseWorkerHeartbeats(db)).
New open note 8: the bullet does not name the threshold. service.ts defaults staleAfterMs to
WORKER_STALE_AFTER_MS; a change raising that default or passing a big value would sit in an owned file but
the bullet would not prompt the check, and its "never ... a default" could be misread as about staleAfterMs.
Suggested: "...and WORKER_STALE_AFTER_MS as the threshold". Note only.
