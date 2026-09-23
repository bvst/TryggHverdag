/**
 * The database schema (Drizzle).
 *
 * One table so far. The journeys, alerts and outbox tables arrive with the
 * safety loop in M2; what matters here is that the shape of the database is
 * described in TypeScript, migrations are generated from it, and the same
 * migrations run in tests, staging and production.
 */
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * A single row saying when the worker last checked in.
 *
 * It is a row rather than a metric because the API has to be able to read it,
 * and the API and the worker are two processes that share nothing but the
 * database (AR-01).
 */
export const workerHeartbeat = pgTable('worker_heartbeat', {
  /** There is one worker loop, so one row: WATCHDOG_HEARTBEAT_ID. */
  id: text('id').primaryKey(),
  beatAt: timestamp('beat_at', { withTimezone: true, mode: 'date' }).notNull(),
});

/** The id of the row the watchdog keeps. */
export const WATCHDOG_HEARTBEAT_ID = 'watchdog';
