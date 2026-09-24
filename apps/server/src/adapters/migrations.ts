/**
 * Bringing a database's schema up to date, with the same SQL files the
 * integration tests run (`src/db/migrations`, written by `pnpm run
 * db:generate`).
 *
 * On Clever Cloud this runs as the pre-run hook, before the API and the worker
 * start, and a failure stops the deploy: new code must never start against an
 * old schema. Drizzle records what it has applied, so running it on every
 * deploy is safe.
 */
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { createDatabase, createPool } from './db.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'db', 'migrations');

export async function migrateDatabase(connectionString: string): Promise<void> {
  // One connection: a migration runs alone, and the API and the worker have
  // not started yet, so it borrows from their budget rather than adding to it.
  const pool = createPool(connectionString, 1);
  try {
    await migrate(createDatabase(pool), { migrationsFolder: MIGRATIONS });
  } finally {
    await pool.end();
  }
}
