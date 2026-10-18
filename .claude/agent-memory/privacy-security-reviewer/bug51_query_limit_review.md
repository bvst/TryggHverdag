---
name: bug51-query-limit-review
description: BUG-51 PASS (4233657) - statement_timeout, QueryLimitClient (per-query 15 s limit that ends the client and releases its pool place), TCP keepalive; what a cut-off query prints, where Drizzle's params could surface, hung-server probe recipe
metadata:
  type: feedback
---

First seen on BUG-51 (2026-10-18, code 3f94034 tests + 4233657 fix, D-132 and amendment). PASS, Notes only.

**Facts (pg 8.23, pg-pool 3.14, drizzle-orm 0.45.3, graphile-worker 0.18.0):**
- client.end() with a query in flight destroys the socket; the 'end' handler gives every query a plain `Error('Connection terminated')` (no properties) and, because `_ending` is set, emits NO 'error': so no database_error line, by design.
- Drizzle wraps it as DrizzleQueryError "Failed query: SQL params: VALUES" (params in message and on `.params`). Every DB call in the worker loops (watchdog open/read/beat, escalation, expiry, push/SMS claim+mark, sms-check) and the API services catches and logs only sqlstateOf(error). The only DB rejection that reaches Graphile's logger is the heartbeat task (`select now()`, lastBeat): no personal params. Canary and sms_check never reject. No addJob anywhere: every job is cron, payload `_cron` only.
- Graphile prints `{job}` / `{jobs}` / `{specs}` (payloads) and the error with %O on "Failed task", "Failed to release job", "Failed to complete/fail jobs". Harmless today; a future job with a personal payload or a task with personal DB params would leak through it (D-068's open Graphile-logger item).
- process.ts runMain / exitOnSignal and the loop catch use describeFailure (redact.ts): message chain incl. Drizzle params, URL password redacted. Params would print if a loop's work() ever rejected on a DB error with personal params; today none can.
- inspect(client, {showHidden:true}) shows the password (pg's non-enumerable field); plain inspect does not. Pre-existing, the subclass adds only `query` (own property) and #private fields.
- The submittable TypeError is fixed text; nothing on these pools sends a submittable.
- PostgreSQL itself logs a 57014 with STATEMENT text (placeholders; log_parameter_max_length_on_error defaults to 0, so no values).

**Probe recipe (scratch, no repo edits, ~1 min):** a net server that answers the startup with R(0), K(pid,secret), Z('I') on the first data and then never writes. (1) tsx .mts in the scratchpad importing db.ts by absolute path and drizzle-orm from apps/server/node_modules/drizzle-orm/index.js; capture stdout/stderr by replacing write; createPool(url with password MARKER, 2, {name, log}); allSettled of a drizzle execute with a marker param, pool.query, sessionLimitsLines. Result: 30 s (2 slots), Drizzle error holds the param marker (expected, caller only), nothing printed, no events, no password. (2) spawn `node --experimental-strip-types apps/server/src/bin/{worker,api}.ts` with only PATH, DATABASE_URL (+PORT=0 for api). worker: exit 1 at ~15.9 s, "worker failed: Error: Connection terminated" (Graphile migrate cut off). api: SIGTERM at 20 s, one line "api: session limits could not be read (none).", exit 0. No marker, no port.

**Test data:** listeningHungPostgres URL is `postgres://synthetic@127.0.0.1:PORT/synthetic` (no password), cancel secret 0x5eed. So the BUG-51 tests cannot detect a password leak on the cut-off path; the LOST-02 AC18 marker tests and the probe above cover it.

**Process:** test commit 3f94034 stubbed two constants in db.ts (commit message says so); a test-auditor matter, not privacy. All three production files are CODEOWNERS-owned. 328 tests in the 4 files pass in ~6 s.

Related: [[bug34-connect-timeout-review]], [[lost-contact-alert-review]], [[heartbeat-log-adapter-review]]
