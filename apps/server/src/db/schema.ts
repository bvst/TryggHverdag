/**
 * The database schema (Drizzle).
 *
 * What matters here is that the shape of the database is described in
 * TypeScript, migrations are generated from it, and the same migrations run in
 * tests, staging and production.
 *
 * The journey tables hold what starting a journey needs and nothing else: no
 * name, phone number, position, platform, push token, address or user agent
 * (D-068, D-077). Each later task adds the columns its own feature needs.
 */
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type PgColumn,
} from 'drizzle-orm/pg-core';
import { JOURNEY_STATES } from '../domain/journey.ts';

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

/** A moment, in database time unless the code says otherwise. */
const moment = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * The people. Only an ID until the login task: nothing in this table says who
 * anyone is, and nothing in the code can add a row yet.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  createdAt: moment('created_at').notNull().defaultNow(),
});

/**
 * Devices, each with the hash of its credential (SEC-07). The credential
 * itself is never stored: a copy of this table opens nothing, because the
 * server hashes whatever it is given.
 */
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    credentialHash: text('credential_hash').notNull().unique(),
    createdAt: moment('created_at').notNull().defaultNow(),
  },
  (table) => [foreignKey({ columns: [table.userId], foreignColumns: [users.id] })],
);

/** The journey states, exactly as the state machine lists them, and no others. */
export const journeyState = pgEnum('journey_state', JOURNEY_STATES);

/**
 * "Not ended": the predicate of the one-unended-journey index below. Written
 * once, because the adapter names the index by it when it inserts, and an
 * insert whose predicate did not match the index's would find no index to
 * name. It names the one state that frees the walker, not the states that
 * block, so a state added later blocks a second journey by default.
 */
export const unended = (state: PgColumn) => sql`${state} <> 'ENDED'`;

/**
 * Journeys (SM-01). `started_at` is the database clock's reading, handed in
 * through the Clock port rather than defaulted here, so the time a start
 * answers with is the time stored.
 */
export const journeys = pgTable(
  'journeys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walkerId: uuid('walker_id').notNull(),
    state: journeyState('state').notNull(),
    startedAt: moment('started_at').notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.walkerId], foreignColumns: [users.id] }),
    // One unended journey per walker, held by the database: two starts that
    // race past the read are stopped here.
    uniqueIndex('journeys_one_unended_per_walker').on(table.walkerId).where(unended(table.state)),
  ],
);

/** Who follows each journey (SM-02: at least one, written with the journey). */
export const journeyResponders = pgTable(
  'journey_responders',
  {
    journeyId: uuid('journey_id').notNull(),
    responderId: uuid('responder_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.journeyId, table.responderId] }),
    foreignKey({ columns: [table.journeyId], foreignColumns: [journeys.id] }),
    foreignKey({ columns: [table.responderId], foreignColumns: [users.id] }),
  ],
);
