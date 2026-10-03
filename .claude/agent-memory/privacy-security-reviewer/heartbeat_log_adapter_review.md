---
name: heartbeat-log-adapter-review
description: Reviewing the first location storage and the server's log adapter (LOST-01) — how to prove nothing reaches stdout/stderr/bodies end to end, oRPC 1.15.3's error/decode path, pino's quiet-by-default facts, and the residual gaps worth flagging
metadata:
  type: feedback
---

First seen on LOST-01 (2026-10-03, head ff583fb). Verdict PASS with should-fixes.

**Why:** a "nothing is logged" claim is only as good as the chain the capture actually exercised. LOST-01's L6 outcome table (AC14) and its L3 AC15 both wire `fakeLog()`; pino ran under capture only on the ENDED path (two controls + api-process). The chain still held by composition (fakeLog records the event as given; log.test.ts pins createLog's line to exactly the event), but say which link is held by what.

**Independent end-to-end probe that works in the Linux session** (no repo edits): a scratch `.mts` (top-level await needs ESM; `.ts` fails under tsx's cjs) importing `apps/server/src/api.ts`, `log.ts`, `modules/journeys/service.ts` and `packages/test-kit/src/index.ts` by absolute path, run with `apps/server/node_modules/.bin/tsx` from `apps/server`. Wire `createLog()` with its default stdout, make the fakes `failWith` an error holding markers in message, `code`, `cause` and `detail`, redirect the child's stdout/stderr to scratch files and grep for every marker. Covers store/read/clock/auth failures, ended, unknown key, non-JSON, 401 vs 400.

**oRPC 1.15.3 facts (read in node_modules):**
- `StandardHandler.handle` catches everything; decode errors become a fixed "Malformed request" BAD_REQUEST, others `toORPCError` → INTERNAL_SERVER_ERROR "Internal server error". `toJSON()` = defined/code/status/message/data, never `cause`. No console output anywhere; `runWithSpan` is a no-op without a global OTel config.
- `customErrorResponseBodyEncoder(error) ?? error.toJSON()` in `StandardOpenAPICodec.encodeError` is the single place every error body is built, decode errors included.
- Body decode (JSON.parse) runs before the procedure, so before auth middleware; zod input validation runs after `os.use` middlewares (SM-01-AC9's contract-driven test sends `{}` with no credential and expects 401 on every route).

**pino 10.3.1:** 13 packages, all MIT, no install scripts, no network. The environment is read only in `lib/transport*.js` (transports, unused unless `transport` is set). With an object destination `{ write }` there is no on-exit hook and no fd-1 write; pino's fd-1 default (`tools.js` buildSafeSonicBoom) is bypassed. `base: null`, `timestamp: false`, `formatters.level` → `{event: label}` give lines of exactly the event.

**Drizzle 0.45.3:** `DrizzleQueryError` message = "Failed query: … params: …" and has `query`, `params`, `cause`, NO `code` (SQLSTATE is on the cause). So a module that logs `error.code` gets null for Drizzle-wrapped reads. Check `drizzle(pool, { logger })` is off (db.ts: `{ schema }` only).

**Residual gaps flagged (should-fix, not block):**
- log.ts holds `code` to a SQLSTATE but passes `journeyId: string` through unchecked: the one free-text slot. `ports.ts` (where LogEvent lives) is unowned, so log.ts is the only owner-gated choke point (D-102). Ask for a UUID-shape check there.
- `heartbeats` rows (receive time every ~60 s + battery) are an activity timeline outside PRIV-04's three categories; make sure README's "Open for M4" names them, not just the spec.

**Still open from earlier decisions, now carrying positions:** PRIV-08 transit encryption to PostgreSQL (D-077, no sslmode); D-077's deploy log to GitHub (outside EEA) for runtime lines. Staging cannot hold real data: no production code creates a device or credential before the login task (device-credentials.ts only reads).

**How to apply:** for any later task that binds a location or phone number: (1) run the probe above against the new route; (2) check every new error path is cleaned at its source or never printed; (3) check the capture tests wire the production log on the failure outcomes, or that a log.test pins exact lines; (4) check new free-string fields in LogEvent are shape-checked in log.ts.

Related: [[merge-rules-codeowners-review]], [[reviewer-sandbox-quirks]], [[dependency-audit-ignore-review]]
