/**
 * The PostgreSQL connection, and Drizzle on top of it.
 *
 * One pool per process, capped low: the staging database is Clever Cloud's free
 * DEV plan, which allows very few connections, and a pool that quietly exhausts
 * it would take the watchdog down with it (Section 8).
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../db/schema.ts';
import { sqlstateOf } from '../domain/sqlstate.ts';
import type { Log } from '../ports.ts';

export type Database = ReturnType<typeof createDatabase>;

/**
 * How many connections each process may hold, and what is left over.
 *
 * Two each leaves one spare on the DEV plan — for a migration, or for a person
 * with `psql` working out why the worker stopped. That spare is why the numbers
 * do not add up to five.
 */
export const POOL_SIZE = { api: 2, worker: 2, spare: 1 } as const;

/** What the DEV plan allows in total (Section 8). The budget above must fit inside it. */
export const DEV_PLAN_CONNECTION_LIMIT = 5;

/** What a process pool is told about itself, and the session limits it asks for. */
export interface PoolOptions {
  /** Which process's pool this is: the name its `database_error` lines carry. */
  name?: 'api' | 'worker';
  /** Where a connection's error is written. With `name`, the pool gets its listeners. */
  log?: Log;
  /** PostgreSQL's idle_in_transaction_session_timeout for every connection, in ms. */
  idleInTransactionMs?: number;
  /** PostgreSQL's lock_timeout for every connection, in ms. */
  lockTimeoutMs?: number;
}

/**
 * The connection pool. Close it with `pool.end()` when a process shuts down.
 *
 * Every pool in production code is made here (D-108: an import rule keeps
 * `pg` and Drizzle's node-postgres driver to this file), so the budget above,
 * the session limits and the listeners hold for all of them.
 *
 * The session limits (D-108) bound how long a journey's row can be held. Both
 * process pools take that row: the API for every heartbeat, the worker for
 * every alert it opens. A frozen holder would hide the journey from every
 * sweep's `skip locked`. So `idleInTransactionMs` has PostgreSQL end a
 * session left idle inside a transaction, and `lockTimeoutMs` refuses a wait
 * for a row that lasts longer, with SQLSTATE 55P03. They travel as startup
 * parameters, so every connection has them before its first statement. A
 * limit not given is not sent, and the server's own setting stands.
 *
 * The listeners (D-068), given a `name` and a `log`, both attached before
 * the pool is returned, so nothing that is handed the pool, Graphile Worker
 * included, ever sees it without them:
 *   - an `error` listener, for a connection that fails while idle in the pool;
 *   - a `connect` listener that gives each new connection an `error`
 *     listener of its own, which stays for its life, so one that fails while
 *     checked out is heard too. pg-pool takes its own listener off a
 *     connection it hands out, and an `error` with nobody listening would end
 *     the process.
 * Each lost connection is one `database_error` line, with the pool's name and
 * the SQLSTATE, or null: never the message, the error or the connection
 * string, which holds the password. A connection reports once, however many
 * errors it raises as it goes (the FATAL, then the closed socket). Then the
 * process carries on: pg drops the dead connection, and a query on one that
 * was checked out rejects, so its caller fails loudly, as a 500 or a failed
 * sweep. A crash would restart the worker, and a worker that restarts stops
 * sweeping.
 *
 * The migrations' pool is made with neither, so a connection lost during a
 * deploy fails that deploy, loudly.
 */
export function createPool(
  connectionString: string,
  max: number,
  { name, log, idleInTransactionMs, lockTimeoutMs }: PoolOptions = {},
): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    ...(idleInTransactionMs === undefined
      ? {}
      : { idle_in_transaction_session_timeout: idleInTransactionMs }),
    ...(lockTimeoutMs === undefined ? {} : { lock_timeout: lockTimeoutMs }),
  });
  if (name !== undefined && log !== undefined) {
    const reported = new WeakSet<object>();
    const report = (error: unknown, client: object): void => {
      if (reported.has(client)) {
        return;
      }
      reported.add(client);
      log.write({ event: 'database_error', pool: name, code: sqlstateOf(error) });
    };
    pool.on('error', (error, client) => {
      report(error, client);
    });
    pool.on('connect', (client) => {
      client.on('error', (error) => {
        report(error, client);
      });
    });
  }
  return pool;
}

export function createDatabase(pool: pg.Pool) {
  return drizzle(pool, { schema });
}
