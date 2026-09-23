# apps/server

Two processes from one codebase (AR-01):

| Entry point | What it is |
|-------------|------------|
| `src/api.ts` | The HTTP API. Hono, with oRPC serving the contract from `packages/contracts` |
| `src/worker.ts` | Graphile Worker. Owns the watchdog, the outbox sender, retention and the canary |

**Neither is a runnable process yet.** `createApi` builds the app but nothing
listens on a port, and `startWorker` has to be handed a connection string.
Binding them to a port and an environment is INF-07's job, with the staging
deployment. Today both exist to be constructed and tested, which is why the
system tests can drive the whole API without a server running at all.

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
