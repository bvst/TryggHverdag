---
name: lost01-library-facts
description: LOST-01 review (2026-10-03) — pino 10.3.1, Drizzle 0.45.3 and oRPC 1.15.3 facts checked by running or reading source; ports.ts holds LogEvent unowned
metadata:
  type: project
---

Saved by the orchestrating session from code-reviewer's report (the role has no write tool).

- **pino 10.3.1, checked by running it:**
  - a level formatter returning `{}`, with `timestamp: false`, writes `{,"x":3}` — not JSON (pino `lib/levels.js` genLsCache, `lib/tools.js` _asJson);
  - a custom level below the logger's `level` threshold becomes pino's `noop`: the event is silently not written;
  - a `void` function whose `switch` misses a union member passes tsc (strict, noImplicitReturns) and lint; typescript-eslint 8.70 has `switch-exhaustiveness-check` only in its `all` preset, not `strictTypeChecked`. Ask for a `never` default.
- **Drizzle 0.45.3** wraps every query error in `DrizzleQueryError`: its message holds the query's parameters, it has no `code` of its own, and PostgreSQL's error is in `cause`. Any read of `.code` (SQLSTATE) must walk `cause`.
- **oRPC 1.15.3:** `customErrorResponseBodyEncoder` (in `encodeError`) is the one place an error becomes a body, the decode step's "Malformed request" 400 included; decoding runs before the middleware, so a non-JSON body without a credential gets 400, not 401. `errors[code]` is a Proxy.
- **Ownership gap found:** `apps/server/src/ports.ts` holds the closed `LogEvent` type that D-102's owned `log.ts` relies on, and has no owner. The old "unowned gate config" note was out of date at `ff583fb` (packages/config, the root configs, coverage-baseline.json and app.config.ts are all in CODEOWNERS) and was deleted.
