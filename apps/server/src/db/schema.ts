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
  ALERT_RESOLUTIONS,
  ALERT_STATES,
  JOURNEY_END_REASONS,
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

/** Why a journey ended, exactly as the state machine lists the reasons (LOST-03, LOST-08): "I'm home", "They're safe" and the 24-hour end. */
export const journeyEndReason = pgEnum('journey_end_reason', JOURNEY_END_REASONS);

/**
 * Both null, or both set: a time and its reason are written together. No
 * check ties them to a state (ENDED, RESOLVED): rows put in directly before
 * they existed have the state without the time, and the migration would
 * refuse them (LOST-03, D-112). The code sets them together.
 */
const togetherOrNeither = (time: PgColumn, reason: PgColumn) =>
  sql`(${time} is null) = (${reason} is null)`;

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
 *
 * `ended_at` and `end_reason` say when and why a journey ended through the
 * code (LOST-03): the database's now() in the transaction that ended it, and
 * HOME for "I'm home". Both null until then, and set together.
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
    endedAt: moment('ended_at'),
    endReason: journeyEndReason('end_reason'),
  },
  (table) => [
    foreignKey({ columns: [table.walkerId], foreignColumns: [users.id] }),
    foreignKey({ columns: [table.deviceId], foreignColumns: [devices.id] }),
    // One unended journey per walker, held by the database: two starts that
    // race past the read are stopped here.
    uniqueIndex('journeys_one_unended_per_walker').on(table.walkerId).where(unended(table.state)),
    check('journeys_ended_at_end_reason_check', togetherOrNeither(table.endedAt, table.endReason)),
  ],
);

/**
 * Who follows each journey (SM-02: at least one, written with the journey).
 * Removing a responder deletes their row (SM-10, D-122 item 4), so every path
 * that tells a responder, which reads these rows, leaves them out.
 */
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

/** How an alert resolved, exactly as the state machine lists the resolutions (LOST-03, LOST-08): contact back, "I'm home", "They're safe" and the 24-hour end. */
export const alertResolution = pgEnum('alert_resolution', ALERT_RESOLUTIONS);

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
 *
 * `resolved_at` and `resolution` say when and how it resolved (LOST-03): the
 * database's now() in the transaction that resolved it, and BACK_IN_CONTACT
 * or HOME. Both null until then, and set together.
 *
 * `acknowledged_by` and `acknowledged_at` say who said "I'm on it", and when
 * (LOST-06): a user, and the database's now() in the transaction that
 * recorded it. Both null until then, and set together; a resolution keeps
 * them, and removing the responder recorded clears both (SM-10). No check
 * ties them to the state: rows put in directly have ACKNOWLEDGED with nobody
 * recorded, and the removal moves a state back (D-114, D-123).
 *
 * `sms_raised_at` says when nobody having acknowledged it for two minutes
 * escalated it to SMS in its current round (LOST-07, SM-10): the database's
 * now() in the transaction that moved it to ESCALATED and wrote every
 * responder's SMS. Null until then, kept by an acknowledgement and a
 * resolution, and cleared by a reset, so the next round escalates; each
 * round's time stays on its SMS rows. No check ties it to the state, for the
 * same reasons (D-116). Not `escalated_at`: every form of "escalate" contains
 * "lat", which the scans for coordinate columns flag.
 *
 * `round` counts the alert's rounds (SM-10, D-123): 1 when opened, one more
 * each time the responder recorded on it is removed. Each message is written
 * with its alert's round, so a second round's SMS and notices are taken by
 * the outbox's unique key, and a second message of a kind in one round is
 * still refused.
 */
export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    journeyId: uuid('journey_id').notNull(),
    state: alertState('state').notNull(),
    openedAt: moment('opened_at').notNull(),
    silentSince: moment('silent_since').notNull(),
    resolvedAt: moment('resolved_at'),
    resolution: alertResolution('resolution'),
    acknowledgedBy: uuid('acknowledged_by'),
    acknowledgedAt: moment('acknowledged_at'),
    smsRaisedAt: moment('sms_raised_at'),
    round: integer('round').notNull().default(1),
  },
  (table) => [
    foreignKey({ columns: [table.journeyId], foreignColumns: [journeys.id] }),
    foreignKey({ columns: [table.acknowledgedBy], foreignColumns: [users.id] }),
    // One alert per journey that is not RESOLVED, held by the database: two
    // sweepers that both got past every check are stopped here.
    uniqueIndex('alerts_one_unresolved_per_journey')
      .on(table.journeyId)
      .where(unresolved(table.state)),
    check(
      'alerts_resolved_at_resolution_check',
      togetherOrNeither(table.resolvedAt, table.resolution),
    ),
    check(
      'alerts_acknowledged_at_acknowledged_by_check',
      togetherOrNeither(table.acknowledgedAt, table.acknowledgedBy),
    ),
    check('alerts_round_check', sql`${table.round} >= 1`),
  ],
);

/** The kinds of message there are, exactly as the domain lists them: the lost-contact alert, its stand-downs (one per resolution, "They're safe" and the 24-hour end included), the notice that someone is on it, the escalation SMS, and the walker's warning that the last responder was removed. */
export const messageKind = pgEnum('message_kind', MESSAGE_KINDS);

/**
 * The outbox (LOST-02, AR-05, D-108): one row per message an alert causes,
 * written in the transaction that opens the alert, and delivered by the
 * worker's sender with retries. `id` is the message's own ID, opaque and
 * random, never a person's, a journey's or an alert's (D-087).
 *
 * A message names its alert, or, for a journey's message, its journey and no
 * alert: the walker's warning that the last responder was removed (SM-02,
 * D-123). Exactly one of the two, held by a check that names no kind: a value
 * added to an enum cannot be used in the migration's transaction that adds
 * it. `round` is its alert's round when it was written, 1 for a journey's
 * message, and is part of the unique key (SM-10).
 *
 * `next_attempt_at` is when it is next due, in database time: at once when
 * written, the end of a claim's lease while it is being sent, and the retry
 * delay after a failure. `sent_at` stays null until the push port accepted
 * it, and `last_failure` holds the port's last reason, if any.
 *
 * `withdrawn_at` is when a message was withdrawn before the port accepted it
 * (LOST-03): from then on no claim hands it out again. A message is withdrawn
 * in one of these ways:
 *   - when its alert resolves, its unsent LOST_CONTACT messages (D-111), its
 *     unsent ACKNOWLEDGED notices (D-113) and its unsent SMS (LOST-07);
 *   - when someone acknowledges its alert, its unsent SMS (LOST-07);
 *   - when a later open on any of the same walker's journeys withdraws an
 *     earlier alert's unsent stand-downs, so none reaches a responder after
 *     the new alert's lost-contact push (D-112, amended);
 *   - when the responder recorded on its alert is removed, its unsent
 *     ACKNOWLEDGED notices; and when its recipient is removed from the
 *     journey, every unsent message of the journey's alerts to them (SM-10,
 *     D-122 item 2).
 * A stand-down (BACK_IN_CONTACT, HOME) is written in the transaction that
 * resolves the alert, as its alert's messages are written in the one that
 * opens it.
 */
export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    alertId: uuid('alert_id'),
    journeyId: uuid('journey_id'),
    recipientId: uuid('recipient_id').notNull(),
    kind: messageKind('kind').notNull(),
    createdAt: moment('created_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: moment('next_attempt_at').notNull(),
    sentAt: moment('sent_at'),
    lastFailure: text('last_failure', { enum: PUSH_FAILURE_REASONS }),
    withdrawnAt: moment('withdrawn_at'),
    round: integer('round').notNull().default(1),
  },
  (table) => [
    foreignKey({ columns: [table.alertId], foreignColumns: [alerts.id] }),
    foreignKey({ columns: [table.journeyId], foreignColumns: [journeys.id] }),
    foreignKey({ columns: [table.recipientId], foreignColumns: [users.id] }),
    // One message per recipient for each kind an alert causes, in each of
    // its rounds (SM-10). A journey's message names no alert, and a null is
    // equal to nothing under a unique key, so this key never holds one back.
    unique('outbox_alert_id_recipient_id_kind_round_unique').on(
      table.alertId,
      table.recipientId,
      table.kind,
      table.round,
    ),
    check(
      'outbox_alert_id_journey_id_check',
      sql`num_nonnulls(${table.alertId}, ${table.journeyId}) = 1`,
    ),
    check('outbox_round_check', sql`${table.round} >= 1`),
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
    // Withdrawn rows stay in it, unsent, until retention removes them too: at
    // the private group's scale that is nothing (LOST-03, approach item 6).
    index('outbox_unsent_due_index')
      .on(table.nextAttemptAt, table.id)
      .where(sql`${table.sentAt} is null`),
  ],
);
