---
name: lost03-home-route-review
description: LOST-03 (back in contact, "I'm home" route) — oRPC detailed input puts request headers (the bearer credential) into ValidationError.data; enumeration probe recipe for a device route; applying migrations on the PG16 stand-in with psql; README "Open for M4" retention pattern
metadata:
  type: feedback
---

First seen on LOST-03 (2026-10-06, HEAD 3471859, code 6add162). Verdict PASS, one should-fix (README retention note), notes only otherwise.

**oRPC 1.15.3 detailed input (`inputStructure: 'detailed'`):** the OpenAPI codec's decode (openapi/dist/shared/openapi.DPiCV5hl.mjs around line 44) returns `{ params, query (lazy), headers: request.headers, body }`, and server's validator throws `ORPCError('BAD_REQUEST', { cause: new ValidationError({ data: input }) })` (server.DEBcqOjg.mjs around line 167). So on ANY 400 of a detailed route, `error.cause.data.headers` holds the Authorization header, i.e. the device credential. Nothing prints it today (probe: 0 bytes on stdout/stderr/console across a non-UUID path, a body key and bad JSON). Re-check whenever api.ts gains an interceptor, plugin, onError or anything that logs `error.cause`. Compact routes have the same shape with the body (positions) in `data`.
- The outer `z.object` (not strict) silently strips `query` and `headers`, so `?journeyId=<other>` is ignored, not refused. Harmless; consistent with compact POST routes.

**Enumeration probe that worked (about 1 s):** scratch `.mts` importing api.ts, log.ts, the three services and `packages/test-kit/src/index.ts` by absolute path, run with `apps/server/node_modules/.bin/tsx` from apps/server. `createLog({ write })` captures production lines. Wrap `journeys.home` to record the call's keys. Cases: another walker's ENDED/ACTIVE journey vs a random UUID (404, byte-identical), same walker other device on ENDED (409, same walker so no leak), query override, bodies null/[]/string/number/__proto__/constructor/bad JSON/urlencoded/text/multipart (all fixed 400, no echo), non-UUID path without credential (401: auth runs before validation), 5000-char path, upper-case UUID (lower-cased, 200), GET (Hono 404), store failure with markers (fixed 500).

**recordHome locks by journey ID only and does not re-check walker/device under the lock.** Sound only because nothing updates journeys.walker_id or device_id (grep `.update(journeys)` then `.set(`: state, lastHeartbeatAt, endedAt/endReason only). Re-check the day a task moves a journey to another device (D-101's consequences).

**PG16 stand-in at 127.0.0.1:55432** (user postgres, no password, psql on PATH): create a scratch database, pipe `begin;` + every migration with `--> statement-breakpoint` replaced by `;` + `commit;` into psql with ON_ERROR_STOP, then read information_schema and pg_enum, then drop it. Proves the one-transaction migration (ALTER TYPE ADD VALUE unused in the same transaction) and the column list independently of testcontainers.

**Retention pattern (PRIV-04), now twice:** a task adding columns or rows with personal timing puts the M4 question in its spec's "Left for later" but not in docs/plan/README.md "Open for M4", which is where M4's planning starts. LOST-01 (heartbeats) was fixed after a should-fix; LOST-03 repeated it: `journeys.ended_at` is the first anchor PRIV-04's "24 h after a journey ends" can count from, D-112 allows ENDED with null ended_at (so a job keyed on ended_at alone keeps those positions silently), and stand-down/withdrawn outbox rows are alert records (30 days). Ask for the README sentence each time.

**Ownership (last-match over changed non-test files):** every choke point owned (api.ts, log.ts, adapters/journeys.ts, schema, migrations, domain, modules/journeys, test-kit, scripts). Unowned: ports.ts (pre-existing), packages/contracts/** except released/ (D-094), docs other than decisions.md.

Related: [[heartbeat-log-adapter-review]], [[lost-contact-alert-review]], [[reviewer-sandbox-quirks]]

**Loop 1 re-check (2026-10-06, HEAD 2aa23f4, delta 3471859..2aa23f4): PASS, no findings left.**
- Should-fix met: README "Open for M4" gained a "Since LOST-03" passage (ended_at as PRIV-04's anchor, ENDED with null ended_at handled loudly by the retention job, stand-downs, withdrawn messages, resolved_at and resolution as 30-day alert records). The retention pattern was caught and fixed in loop 1 both times; keep asking.
- The recordHome caveat above is closed: recordHome now takes { journeyId, walkerId, deviceId }, selects walker, device and state FOR UPDATE and asks the domain's transition() under the lock (AR-04). A refusal throws an Error whose message holds only decision.reason (an enum); stage() logs only sqlstateOf (null here), and the API answers the fixed 500.
- The watchdog's open now withdraws earlier alerts' unsent non-LOST_CONTACT outbox rows (D-112 amended). It has no log line, and the push payload is unchanged (messageId, recipientId, kind). It only removes pushes.
- LOST-03-AC19 (4a) is the credential capture test for a 400. **Mutant recipe that worked (about 1 min for 6):** tar the repo minus node_modules/.pnpm and .git into the scratchpad, symlink the real .pnpm in, then a node runner in a separate scratch tools dir string-replaces api.ts's customErrorResponseBodyEncoder (anchor: the two-line arrow), runs `vitest run src/contact.system.test.ts -t "a 400 from the"` and restores the file in finally. Killed all 6: console.error(error), stderr JSON.stringify(error.cause), stdout of cause.data.headers.authorization, setImmediate console.log(cause), clientInterceptors catch then console.warn, console.info(cause.data). So the headers in cause.data are a plain object (JSON.stringify leaks them), and client interceptors see the validation error.
- CODEOWNERS was not touched in the delta. Every changed production file is owned except ports.ts, which was already unowned.
