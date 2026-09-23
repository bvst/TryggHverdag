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

/** The connection pool. Close it with `pool.end()` when a process shuts down. */
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 5 });
}

export function createDatabase(pool: pg.Pool) {
  return drizzle(pool, { schema });
}
