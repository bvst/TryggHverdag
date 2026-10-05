/**
 * The database schema (Drizzle).
 *
 * What matters here is that the shape of the database is described in
 * TypeScript, migrations are generated from it, and the same migrations run in
 * tests, staging and production.
 *
 * The journey tables hold what starting a journey needs and nothing else: no
 * name, phone number, platform, push token, address or user agent (D-068,
 * D-077). Each later task adds the columns its own feature needs. LOST-01 adds
 * the heartbeats, and positions in one table, `positions`, and nowhere else,
 * so the retention rule's deletion has one target.
 *
 * Foreign keys are declared with `foreignKey()` in each table's extra-config
 * callback, beside its indexes, so a table's constraints read as one list;
 * Drizzle builds the same constraint, by the same name, as an inline
 * `.references()` would.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type PgColumn,
} from 'drizzle-orm/pg-core';
import {
  ALERT_STATES,
  JOURNEY_STATES,
  MESSAGE_KINDS,
  PUSH_FAILURE_REASONS,
} from '../domain/journey.ts';

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
 *
 * `device_id` is the device that sent the start, the only one whose
 * heartbeats the journey takes (D-101). Not null, with no default: the
 * migration that added it refuses to run beside a journey that already
 * exists, rather than guess its device.
 *
 * `last_heartbeat_at` is last contact, in database time: null until the first
 * heartbeat, and never moved backwards (SM-09).
 */
export const journeys = pgTable(
  'journeys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walkerId: uuid('walker_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    state: journeyState('state').notNull(),
    startedAt: moment('started_at').notNull(),
    lastHeartbeatAt: moment('last_heartbeat_at'),
  },
  (table) => [
    foreignKey({ columns: [table.walkerId], foreignColumns: [users.id] }),
    foreignKey({ columns: [table.deviceId], foreignColumns: [devices.id] }),
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

/**
 * Heartbeats (LOST-01): one row per event a journey received, and no
 * location. `id` counts arrivals, so it breaks a tie between two receive
 * times; `received_at` is database time (SM-09); `battery_level` is null for
 * unknown, and lives here rather than beside a position, because a heartbeat
 * without a position still reports it.
 *
 * Held by the database as well as the contract: an event ID once per journey
 * (SM-08), in the contract's characters and length, and a battery level from
 * 0 to 1. PostgreSQL's NaN sorts above every number, so the upper bound
 * refuses it too.
 */
export const heartbeats = pgTable(
  'heartbeats',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    journeyId: uuid('journey_id').notNull(),
    eventId: text('event_id').notNull(),
    receivedAt: moment('received_at').notNull(),
    batteryLevel: doublePrecision('battery_level'),
  },
  (table) => [
    foreignKey({ columns: [table.journeyId], foreignColumns: [journeys.id] }),
    unique('heartbeats_journey_id_event_id_unique').on(table.journeyId, table.eventId),
    check('heartbeats_event_id_check', sql`${table.eventId} ~ '^[A-Za-z0-9-]{1,64}$'`),
    check(
      'heartbeats_battery_level_check',
      sql`${table.batteryLevel} >= 0 and ${table.batteryLevel} <= 1`,
    ),
    // A journey's latest heartbeat: the greatest receive time, a tie to the
    // one that arrived last.
    index('heartbeats_latest_index').on(table.journeyId, table.receivedAt.desc(), table.id.desc()),
  ],
);

/**
 * Positions (LOST-01): the one table that holds coordinates, one row beside
 * the heartbeat that carried it. `recorded_at` is the phone's clock, kept as
 * the position's label and never used to decide anything (REL-01).
 *
 * Bounded as the contract bounds them. Each bound is a closed range, so NaN,
 * which PostgreSQL sorts above every number, and ±Infinity are refused with
 * it; the accuracy has no natural upper bound, so it is held below Infinity
 * explicitly, since `>= 0` alone admits both.
 */
export const positions = pgTable(
  'positions',
  {
    heartbeatId: bigint('heartbeat_id', { mode: 'number' }).primaryKey(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    accuracyMeters: doublePrecision('accuracy_m').notNull(),
    recordedAt: moment('recorded_at').notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.heartbeatId], foreignColumns: [heartbeats.id] }),
    check('positions_latitude_check', sql`${table.latitude} >= -90 and ${table.latitude} <= 90`),
    check(
      'positions_longitude_check',
      sql`${table.longitude} >= -180 and ${table.longitude} <= 180`,
    ),
    check(
      'positions_accuracy_m_check',
      sql`${table.accuracyMeters} >= 0 and ${table.accuracyMeters} < 'Infinity'::double precision`,
    ),
  ],
);

/** The alert states, exactly as the state machine lists them, in order, and no others (D-033). */
export const alertState = pgEnum('alert_state', ALERT_STATES);

/**
 * "Not resolved": the predicate of the one-open-alert index below, written
 * once, as `unended` is. It names the one state that frees the journey, so a
 * state added later counts as an alert still going by default.
 */
export const unresolved = (state: PgColumn) => sql`${state} <> 'RESOLVED'`;

/**
 * Alerts (LOST-02): one per silence. `opened_at` is the database's now() in
 * the transaction that opened it, and `silent_since` the journey's last
 * contact then, or its start if it had none: the heartbeat received at that
 * moment holds the battery level and the position a responder's app reads,
 * so nothing of them is copied here.
 */
export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    journeyId: uuid('journey_id').notNull(),
    state: alertState('state').notNull(),
    openedAt: moment('opened_at').notNull(),
    silentSince: moment('silent_since').notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.journeyId], foreignColumns: [journeys.id] }),
    // One alert per journey that is not RESOLVED, held by the database: two
    // sweepers that both got past every check are stopped here.
    uniqueIndex('alerts_one_unresolved_per_journey')
      .on(table.journeyId)
      .where(unresolved(table.state)),
  ],
);

/** The kinds of message there are, exactly as the domain lists them. Only the lost-contact alert, for now. */
export const messageKind = pgEnum('message_kind', MESSAGE_KINDS);

/**
 * The outbox (LOST-02, AR-05, D-108): one row per message an alert causes,
 * written in the transaction that opens the alert, and delivered by the
 * worker's sender with retries. `id` is the message's own ID, opaque and
 * random, never a person's, a journey's or an alert's (D-087).
 *
 * `next_attempt_at` is when it is next due, in database time: at once when
 * written, the end of a claim's lease while it is being sent, and the retry
 * delay after a failure. `sent_at` stays null until the push port accepted
 * it, and `last_failure` holds the port's last reason, if any.
 */
export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    alertId: uuid('alert_id').notNull(),
    recipientId: uuid('recipient_id').notNull(),
    kind: messageKind('kind').notNull(),
    createdAt: moment('created_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: moment('next_attempt_at').notNull(),
    sentAt: moment('sent_at'),
    lastFailure: text('last_failure', { enum: PUSH_FAILURE_REASONS }),
  },
  (table) => [
    foreignKey({ columns: [table.alertId], foreignColumns: [alerts.id] }),
    foreignKey({ columns: [table.recipientId], foreignColumns: [users.id] }),
    // One message per recipient for each kind an alert causes.
    unique('outbox_alert_id_recipient_id_kind_unique').on(
      table.alertId,
      table.recipientId,
      table.kind,
    ),
    check('outbox_attempts_check', sql`${table.attempts} >= 0`),
    // Null, or one of the port's reasons: the list above, written into the
    // constraint as literals, since DDL takes no parameters.
    check(
      'outbox_last_failure_check',
      sql`${table.lastFailure} in (${sql.raw(PUSH_FAILURE_REASONS.map((reason) => `'${reason}'`).join(', '))})`,
    ),
    // The claim's: the unsent messages, in the order the claim takes them.
    // It runs every 10 s against a table that only grows, since a sent row
    // stays until retention removes it (M4), and this holds the unsent alone.
    index('outbox_unsent_due_index')
      .on(table.nextAttemptAt, table.id)
      .where(sql`${table.sentAt} is null`),
  ],
);
