---
name: bug34-connect-timeout-review
description: BUG-34 PASS (befe3ed) - pg connection timeout via a pg.Client subclass in createPool; what the config spread drops, the bin-entry silent-database probe recipe, what each process prints on a timeout
metadata:
  type: feedback
---

First seen on BUG-34 (2026-10-18, head befe3ed, base 0c0b239). PASS, Notes only.

**Facts (pg 8.23.0, pg-pool 3.14.0, read in node_modules/.pnpm):**
- pg-pool's newClient does `new this.Client(this.options)`; `this.options` is an
  Object.assign copy whose `password` (if given as a separate option) is made
  non-enumerable, as is `ssl.key` on the shared ssl object.
- A subclass spreading `{ ...config }` therefore DROPS a separately given
  password (client.password null, then PGPASSWORD/pgpass) but keeps ssl by
  reference (key and rejectUnauthorized intact). Fails closed (auth error), not
  a leak. createPool passes only connectionString, so today nothing is lost.
- The timeout error is fixed text `new Error('timeout expired')` (client.js
  _connect); pg clears the timer on ReadyForQuery, so only the handshake (TLS
  included) is bounded. A connection that never connected emits no pool
  'error', so no database_error line.
- inspect(client) and JSON.stringify(client) do not show the URL password.

**Probe recipe (one scratch .mjs, ~30 s, no repo edits):** a net server on
127.0.0.1 that records each socket's first 8 bytes and never writes; spawn
`node --experimental-strip-types apps/server/src/bin/{worker,migrate,api}.ts`
with env {PATH, DATABASE_URL=postgres://synthetic:MARKER@127.0.0.1:port/synthetic,
PORT for api}; capture stdout+stderr; grep MARKER. Health route is `/v1/health`
(API_PREFIX), not `/health` (404). Add `?sslmode=require` to see the SSLRequest
(first bytes 0000000804d2162f) go out through the subclass.
Results on befe3ed: worker exit 1 in ~5.8 s, "worker failed: Error: timeout expired";
migrate exit 1, "migration failed: Error: Failed query: CREATE SCHEMA IF NOT
EXISTS "drizzle" params:  <- Error: timeout expired"; API /v1/health 500 with
the generic oRPC body after ~5.9 s, one line "api: session limits could not be
read (none).", SIGTERM exit 0; no marker anywhere; every socket closed.

**Test-quality note:** the worker test's `not.toContain(marker)` is real (the
marker is in the URL; `written` captures runMain and the worker's own writes)
but cannot fail on today's path, since the timeout message is fixed text;
Graphile's console logger is not captured by it (the bin probe covers that).

Related: [[heartbeat-log-adapter-review]], [[lost-contact-alert-review]], [[reviewer-sandbox-quirks]]
