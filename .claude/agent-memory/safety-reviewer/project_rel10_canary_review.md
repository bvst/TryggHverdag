---
name: rel10-canary-review
description: REL-10 staging canary main PR review — PASS 2a56f8a; run.ts/domain/adapter/worker verified, L3 adapter mutants, departure 2 probe, open should-fix on the brief item
metadata:
  type: project
---

PASS at 2a56f8a (2026-10-10), branch claude/busy-faraday-40n2zl.

Verified:
- run.ts reads no clock; decisions on observation.now; any non-StepFailed throw lands in the halted path
  (INTERRUPTED if stop.aborted else RUN_LIMIT, which pages), so unexpected errors page too.
- Margins vs LOST-07: alert opens >= 300 s, escalation >= opened + 120 s = 420 s; home sent by ~362 s plus
  one request (10 s client timeout) -> >= ~45 s margin even for failing verdicts. Stranded journeys
  (start answered after halt, home failing) escalate and page staging-sms; spec item 7 accepts that.
- Departure 2 as coded differs from the implementer's wording: outcome is fixed BEFORE the 5 s home wait,
  so limit-then-stop logs RUN_LIMIT, then report(stop aborted) fails -> canary_report_failed; no page.
  Probe: hand-made Wait/client/store stubs via node strip-types from apps/server. No test pins it.
- L3 adapter mutants (scratch config spreading the L3 stand-in config + enforce:'pre' transform on
  adapters/canary.ts): setWhere, recipient filter, walker filter, lastFailure, SMS kind, kind all killed;
  `order by opened_at desc` -> asc SURVIVES (equivalent while a canary journey has one alert: one beat).
- Stryker ignorePatterns are appended to ALWAYS_IGNORE (core 10 project-reader.js), so the new
  'infra/**/.terraform' adds, never replaces; matches only .terraform dirs, not .terraform.lock.hcl.

Open (should-fix/notes): brief item lacks the own-check rule (UUID differs from worker/SMS), the 10-minute
bound, CANARY_CRONTAB only with a usable URL, minute tasks unaffected; failing verdict drops home's status
from the run line; progress.md row 9 and lines 443-445 stale ("tests next", filter "after REL-10's");
config.ts still unowned (decides scheduling). Worker pool is 2 connections shared with Graphile, loops
and canary polls — no L3 contention measurement.
