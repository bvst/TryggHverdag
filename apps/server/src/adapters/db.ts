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

/**
 * The connection pool. Close it with `pool.end()` when a process shuts down.
 *
 * No `pool.on('error', ...)` here, and that is a decision rather than an
 * oversight (D-068). Without a listener an idle client's error exits the
 * process, which is loud — the platform restarts it, and if it is the worker
 * the heartbeat stops and `/v1/health` reports `degraded` within three minutes.
 * A handler that swallowed the event would trade that for silence; a handler
 * that reported it needs somewhere to report to, and that belongs to the task
 * that decides how logging works, not to this one. The handler goes here when
 * it does. D-068 has the reasoning and the privacy rule behind it — named there
 * rather than here, because a requirement ID in product code reads to RG-01 as
 * a claim to implement it, and this is a reason for deferring, not a claim.
 */
export function createPool(connectionString: string, max: number): pg.Pool {
  return new pg.Pool({ connectionString, max });
}

export function createDatabase(pool: pg.Pool) {
  return drizzle(pool, { schema });
}
