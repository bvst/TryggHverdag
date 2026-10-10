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

**Loop 1: PASS at 880d2ba (2026-10-10).** All three should-fixes closed (brief item + ai-review pin; limit-then-stop
pinned at L6 with the fake alarm now rejecting an already-aborted signal, as AbortSignal.any in healthchecks.ts ping
does; progress row 9). New RUN_FAILED: catch splits Halted (INTERRUPTED/RUN_LIMIT) from anything else; bounded
home in try/catch/finally. Planted 4 mutants via scratch config (scratchpad/sr-rel10-l1/mutant.config.mjs, MUTANT env,
spreads vitest.system.config.mjs): rethrow in home catch, Halted check -> true, drop stopLimit.abort, fake's aborted
check -> false: all killed. Real node:timers/promises delay probe (realwait-probe.ts piped to node from apps/server):
a stop during first look / poll waits gives INTERRUPTED, no report (Halted's listener is registered first, so it
wins the race over delay's AbortError) -> no false page per deploy. Stryker survivors 183 {end:null}->{} and 318
guard->true are equivalent (calling a missing end throws sync inside the new try, before the 5 s wait starts).
Open notes: RUN_FAILED (and RUN_LIMIT/INTERRUPTED) after a failed verdict masks NOT_OPENED in the line (both page,
MISSED_ALERT_OUTCOMES used nowhere in production); rotation steps do not warn that an old-worker run in flight at the
restart gets 401 and may page (canary, and SMS check via a stranded journey's escalation).
