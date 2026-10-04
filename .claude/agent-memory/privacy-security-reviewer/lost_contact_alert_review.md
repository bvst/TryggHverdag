---
name: lost-contact-alert-review
description: LOST-02 (watchdog, outbox, push port, pool listeners, one-way-to-the-database import rule) — how to probe import rules in a scratch copy, the holes found in the rule, the AC18 mutation proof, the push-wiring gap, graphile's own LISTEN logger
metadata:
  type: feedback
---

First seen on LOST-02 (2026-10-04, code at 6f27b80; HEAD moved mid-review to e36a384, a docs-only requirements-status regen). Verdict PASS with should-fixes.

**Why:** an import rule is only as good as the routes it does not name, and a "never logs X" test only as good as a mutant it kills. Probe both, do not read them.

**Import-rule probe recipe (works in the Linux session, about 3 s per depcruise run):**
- `tar --exclude=./.git --exclude=./node_modules/.pnpm --exclude=./apps/mobile/android --exclude=./apps/mobile/ios --exclude=./reports -cf - . | tar -x -C <copy>`, then `ln -s <repo>/node_modules/.pnpm <copy>/node_modules/.pnpm`. About 276 MB. Vitest also runs in this copy.
- Symlinking whole node_modules folders into a git-archive copy FAILS: depcruise 18.4 says "Unusual baseDir passed to package reading function", because workspace packages then resolve outside the copy.
- Drop probe files under apps/server/src/modules/alerts/ in the copy and run `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs .claude/hooks apps packages scripts`.
- Rule diff: write origin/main's `packages/config/dependency-cruiser.cjs` into the copy's packages/config (its workspace check needs that dirname), require both, and JSON-compare severity/from/to per rule name plus options. LOST-02 loosened only what D-108 records: domain-has-no-io exempts test files and admits zod/contracts in resolved form; the log rule admits worker.ts.

**depcruise 18.4 facts:** `doNotFollow` also filters the initial source scan (src/extract/gather-initial-sources.mjs around line 36), so removing node_modules from `exclude` does not make node_modules a source. Resolved targets here: pg goes to `pg/esm/index.mjs`, drizzle-orm/node-postgres to its `.d.ts`, graphile-worker to `dist/index.js`. `tsPreCompilationDeps: true`, so type-only imports count.

**Routes the one-way-to-the-database rule does not refuse (should-fix or note, not block):**
- `drizzle-kit/api` (a devDependency of apps/server) builds `new pg.Pool({ connectionString })` (api.js around line 72389, the Studio server). No rule refuses production code importing a devDependency.
- Test-file laundering: production code importing `x.test.ts`, which imports pg or log.ts. Every TEST_FILE exemption has this hole, and there is no "production may not import tests" rule. vitest fails a test file with no test, so it needs a dummy test, but it gets past the import check.
- `createRequire(import.meta.url)('pg')` and a computed `import(name)`: the limit of static analysis.
- Folders named build/dist/coverage/.turbo/.expo anywhere in the source tree are excluded from the cruise. This predates LOST-02 and is gitignored, so it needs `git add -f`.

**AC18 (D-068) proof that held:** 5 hand mutants of db.ts's `report` (console.error(error), message to stderr, connection string to stdout, an extra field on the event, message passed as code) were all killed by the AC18 tests in api-process.test.ts and worker.test.ts. The fake PostgreSQL server sends a real FATAL ErrorResponse (S/C/M) and the URL holds the marker password. The worker tests use fakeLog, which records events as given, and include its JSON in the marker search.

**Push wiring gap (should-fix, safety-adjacent):** changing runWorkerProcess's `push: UNCONFIGURED_PUSH`, or startWorker's default, to a push that accepts everything passes all 96 tests in the process group (worker, process, bin). Only UNCONFIGURED_PUSH's own body is pinned. Nothing sends a due message through the default worker: the AC19 default test's fake database refuses the claim, and deploy.integration's outbox is empty.

**graphile-worker 0.18.0:** it installs its own pool handlers only when `listeners('error')` or `listeners('connect')` is 0 (dist/lib.js around line 197), so createPool's listeners keep them out. But its LISTEN client's own handler logs `Error with notify listener (...): ${err.message}` with `{ error: err }`, and @graphile/logger 0.3.0 prints meta with `%O`: the whole error object on console. That connection runs only LISTEN and UNLISTEN, so nothing personal or secret is in it. It also means "one database_error line per lost connection" is not literally true for that client.

**Data model:** PRIV-04 already names "alert records (who was alerted, when, last known position), 30 days", which covers alerts and outbox, and M4's roadmap row carries the retention jobs. The foreign keys are ON DELETE no action (outbox.recipient_id to users, outbox.alert_id to alerts, alerts.journey_id to journeys), so M4's account deletion (PRIV-04, PRIV-09) is refused loudly until outbox rows go first. alerts copies no position, while positions are deleted 24 h after a journey ends; M4 decides how that fits PRIV-04's "last known position" in alert records.

**How to apply:** on any later outbox message type or push adapter (M3), check that the sender destructures exactly messageId, recipientId and kind; that recipientId never reaches the payload, headers or collapse ID (D-087's L6 test); and that the production wiring of the push is pinned by a test that sends a due message through the default worker.

Related: [[heartbeat-log-adapter-review]], [[merge-rules-codeowners-review]], [[reviewer-sandbox-quirks]]
