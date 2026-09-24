# apps/server

Two processes from one codebase (AR-01):

| Entry point | What it is |
|-------------|------------|
| `src/api.ts` | The HTTP API. Hono, with oRPC serving the contract from `packages/contracts` |
| `src/worker.ts` | Graphile Worker. Owns the watchdog, the outbox sender, retention and the canary |

`createApi` and `startWorker` take their dependencies, so tests can build them
against fakes. The processes that run on a server are in `src/bin/` (INF-07):

| Process | Started by | What it does |
|---------|-----------|--------------|
| `src/bin/migrate.ts` | Clever Cloud's pre-run hook, before every start | Brings the schema up to date. A failure stops the deploy |
| `src/bin/api.ts` | Clever Cloud's run command | `startApiProcess`: the real adapters, the API, `0.0.0.0:$PORT` (8080) |
| `src/bin/worker.ts` | `CC_WORKER_COMMAND`, beside the API | `startWorker`; exits with 1 if the runner ends without being asked, so it is restarted |

All three read `DATABASE_URL`, or `POSTGRESQL_ADDON_URI`, which Clever Cloud
sets for a linked database (`src/config.ts`). On SIGTERM they stop cleanly;
on failure they exit with 1 and print one line, with any password removed
(`src/process.ts`, D-077).

There is no build step: Node strips the types when it starts
(`node --experimental-strip-types src/bin/api.ts`). `src/bin/bin.test.ts` runs
the entry files exactly that way, because every other test runs through
Vitest, which compiles TypeScript itself.

Inside:

| Folder | Rule |
|--------|------|
| `src/domain/` | Pure rules. No input or output, no clock (AR-02, AR-03). Enforced by lint and the import rules |
| `src/adapters/` | Everything that touches the outside: PostgreSQL, the clock, later push and SMS. Each has a fake in `packages/test-kit` |
| `src/db/` | The Drizzle schema and its migrations |
| `src/modules/` | Wiring: a module takes adapters, asks the domain, and returns a contract type |

## Tests

| File pattern | Level | Needs |
|--------------|-------|-------|
| `*.test.ts` | L2 domain | nothing |
| `*.integration.test.ts` | L3 | Docker — a real PostgreSQL through Testcontainers |
| `*.system.test.ts` | L6 | nothing: the whole API in-process, with fakes and a clock the test moves |

`pnpm run test:unit` deliberately excludes the last two, so a machine without
Docker still gets a fast, honest answer rather than a confusing failure.
