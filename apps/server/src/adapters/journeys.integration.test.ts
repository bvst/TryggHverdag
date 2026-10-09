// L3 server integration: starting a journey against a real PostgreSQL.
//
// SM-01 is decided by the domain and enforced by the database. The system
// tests prove the deciding, against a fake; only a real database can prove
// the enforcing: the partial unique index that stops two racing starts, the
// transaction that writes a journey and its responders together or not at
// all, the foreign keys behind "an existing user", and the column that admits
// exactly the states the state machine lists. SM-02's start rule is checked
// here against the real users table.
//
// The users, devices and journeys a test needs are inserted directly, as the
// spec says to: nothing in this task can create a user or a device, and
// nothing can end a journey. Device rows hold hashCredential(credential), so
// the real authenticator finds them. Since D-101 every journey row names the
// device that started it, so a journey inserted directly needs a device row.
//
// LOST-01 adds the heartbeat: the same shared behaviour suite runs its
// heartbeat rules here, and the tests below prove what only the real tables
// can: the database's own time, the row lock and the unique index that let
// racing copies leave one, a heartbeat stored whole or not at all, the
// constraints, the one place coordinates live, and an error cleaned of the
// position before anything can print it (PRIV-07).
//
// PostgreSQL 15, staging's version, as deploy.integration.test.ts explains.
// Needs Docker, like every *.integration.test.ts: CI's integration job runs
// it, a cloud session cannot.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startJourneyResponseSchema } from '@trygghverdag/contracts';
import {
  JOURNEY_STORE_BEHAVIOUR,
  RACE_ROUNDS,
  RACERS,
  apiPath,
  endTestPool,
  fakeLog,
  syntheticBatteryLevel,
  syntheticCredential,
  syntheticEventId,
  syntheticHeartbeat,
  syntheticPosition,
  syntheticUuid,
  toStoredPosition,
  type AcknowledgementAsStored,
  type AlertAsStored,
  type AlertRound,
  type EscalationAsStored,
  type FakeJourneyState,
  type FakeLog,
  type HeartbeatAsStored,
  type MessageAsStored,
  type HeartbeatToRecord,
  type JourneyAsStored,
  type JourneyEndAsStored,
  type JourneyMessageAsStored,
  type JourneyStoreUnderTest,
  type MessageRound,
  type PositionAsStored,
  type ResolutionAsStored,
  type SyntheticHeartbeat,
  type WithdrawalAsStored,
} from '@trygghverdag/test-kit';
import { sql } from 'drizzle-orm';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../api.ts';
import { captured, markersIn, markersOf } from '../capture.test.ts';
import {
  ALERT_RESOLUTIONS,
  ALERT_STATES,
  JOURNEY_END_REASONS,
  JOURNEY_STATES,
  LOST_CONTACT_AFTER_MS,
  MESSAGE_KINDS,
  type JourneyState,
} from '../domain/journey.ts';
import { sqlstateOf } from '../domain/sqlstate.ts';
import { createHealthService } from '../modules/health/service.ts';
import { createJourneyService } from '../modules/journeys/service.ts';
import { databaseClock } from './clock.ts';
import { createDatabase, createPool, type Database } from './db.ts';
import { databaseDeviceAuthenticator, hashCredential } from './device-credentials.ts';
import { HeartbeatStoreError, databaseJourneyStore } from './journeys.ts';
import { migrateDatabase } from './migrations.ts';
import { databaseWorkerHeartbeats } from './worker-heartbeats.ts';

/** What Clever Cloud's DEV plan runs; see deploy.integration.test.ts. */
const STAGING_POSTGRES = 'postgres:15-alpine';

/** Enough connections that every racing start holds its own. */
const CONNECTIONS = RACERS + 2;

const EARLIER = new Date('2026-10-01T20:00:00.000Z');

/** The partial unique index that holds one unended journey per walker. */
const ONE_UNENDED_INDEX = 'journeys_one_unended_per_walker';

/** Every state the module lists but the one that frees the walker. */
const UNENDED_STATES = JOURNEY_STATES.filter(
  (state): state is Exclude<JourneyState, 'ENDED'> => state !== 'ENDED',
);

let container: StartedPostgreSqlContainer | undefined;
let pool: pg.Pool | undefined;
let db: Database | undefined;

beforeAll(async () => {
  container = await new PostgreSqlContainer(STAGING_POSTGRES).start();
  // The deploy's own migration step, not a schema built by hand.
  await migrateDatabase(container.getConnectionUri());
  pool = createPool(container.getConnectionUri(), CONNECTIONS);
  db = createDatabase(pool);
}, 180_000);

afterAll(async () => {
  // endTestPool, not pool.end() alone: the pool's sockets are still closing
  // when end() resolves, and stopping the container then hands the pool a
  // 57P01 it has no listener for, which fails the run with every test
  // passed. The test kit says why; the production pool keeps none (D-068).
  await endTestPool(pool);
  await container?.stop();
});

function connectionUri(): string {
  if (container === undefined) {
    throw new Error('The container did not start, so there is nothing to test against.');
  }
  return container.getConnectionUri();
}

function database(): Database {
  if (db === undefined) {
    throw new Error('The container did not start, so there is nothing to test against.');
  }
  return db;
}

function connection(): pg.Pool {
  if (pool === undefined) {
    throw new Error('The container did not start, so there is nothing to query.');
  }
  return pool;
}

// ---------------------------------------------------------------------------
// Rows, put in and read back directly.
// ---------------------------------------------------------------------------

async function addUser(): Promise<string> {
  const id = syntheticUuid();
  await connection().query('insert into users (id) values ($1)', [id]);
  return id;
}

/** A device of this user, and the credential it would send. */
async function addDevice(userId: string): Promise<{ deviceId: string; credential: string }> {
  const deviceId = syntheticUuid();
  const credential = syntheticCredential();
  await connection().query(
    'insert into devices (id, user_id, credential_hash) values ($1, $2, $3)',
    [deviceId, userId, hashCredential(credential)],
  );
  return { deviceId, credential };
}

/** A user with a device, and the credential that device would send. */
async function walker(): Promise<{ userId: string; deviceId: string; credential: string }> {
  const userId = await addUser();
  return { userId, ...(await addDevice(userId)) };
}

/**
 * A journey written straight into the tables, in any state, with its
 * responders, started from this device (D-101: `device_id` is not null).
 */
async function seedJourney({
  walkerId,
  deviceId,
  state,
  responderIds,
  startedAt,
  lastHeartbeatAt = null,
}: {
  walkerId: string;
  deviceId: string;
  state: FakeJourneyState;
  responderIds: readonly string[];
  startedAt: Date;
  lastHeartbeatAt?: Date | null;
}): Promise<string> {
  const id = syntheticUuid();
  const client = await connection().connect();
  try {
    await client.query('begin');
    await client.query(
      'insert into journeys (id, walker_id, device_id, state, started_at, last_heartbeat_at) ' +
        'values ($1, $2, $3, $4, $5, $6)',
      [id, walkerId, deviceId, state, startedAt, lastHeartbeatAt],
    );
    for (const responderId of responderIds) {
      await client.query(
        'insert into journey_responders (journey_id, responder_id) values ($1, $2)',
        [id, responderId],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  return id;
}

/** Every journey the walker has, as the tables hold it. Times to the millisecond, as a Date holds them. */
async function journeysOf(walkerId: string): Promise<JourneyAsStored[]> {
  const result = await connection().query<{
    id: string;
    walker_id: string;
    state: string;
    started_ms: string;
    responder_ids: string[];
  }>(
    `select j.id::text as id,
            j.walker_id::text as walker_id,
            j.state::text as state,
            floor(extract(epoch from j.started_at) * 1000)::bigint::text as started_ms,
            coalesce(
              (select array_agg(r.responder_id::text order by r.responder_id::text)
                 from journey_responders r where r.journey_id = j.id),
              '{}'
            ) as responder_ids
       from journeys j
      where j.walker_id = $1
      order by j.started_at, j.id`,
    [walkerId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    walkerId: row.walker_id,
    state: row.state,
    startedAt: new Date(Number(row.started_ms)),
    responderIds: row.responder_ids,
  }));
}

/**
 * Ends a journey directly, as a test's own setup, without the "I'm home"
 * route or any rule: no end time and no end reason, as a journey ended by
 * hand in the database has neither.
 */
async function endJourney(journeyId: string): Promise<void> {
  await connection().query("update journeys set state = 'ENDED' where id = $1", [journeyId]);
}

/** The device `journeys.device_id` names for this journey, or null if there is no such journey. */
async function deviceOf(journeyId: string): Promise<string | null> {
  const result = await connection().query<{ device_id: string }>(
    'select device_id::text as device_id from journeys where id = $1',
    [journeyId],
  );
  return result.rows[0]?.device_id ?? null;
}

async function stateOf(journeyId: string): Promise<string | null> {
  const result = await connection().query<{ state: string }>(
    'select state::text as state from journeys where id = $1',
    [journeyId],
  );
  return result.rows[0]?.state ?? null;
}

/** A moment as milliseconds since the epoch, in SQL, floored as a Date floors it. */
const MS = (column: string) => `floor(extract(epoch from ${column}) * 1000)::bigint::text`;

async function lastHeartbeatAt(journeyId: string): Promise<Date | null> {
  const result = await connection().query<{ ms: string | null }>(
    `select ${MS('last_heartbeat_at')} as ms from journeys where id = $1`,
    [journeyId],
  );
  const ms = result.rows[0]?.ms;
  return ms === undefined || ms === null ? null : new Date(Number(ms));
}

/** Every heartbeat of the journey, as the table holds it. Numbers read as double precision. */
async function heartbeatsOf(journeyId: string): Promise<HeartbeatAsStored[]> {
  const result = await connection().query<{
    event_id: string;
    received_ms: string;
    battery_level: number | null;
  }>(
    `select event_id, ${MS('received_at')} as received_ms,
            battery_level::float8 as battery_level
       from heartbeats where journey_id = $1 order by id`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    eventId: row.event_id,
    receivedAt: new Date(Number(row.received_ms)),
    batteryLevel: row.battery_level,
  }));
}

/** Every position the journey's heartbeats carried, named by the heartbeat's event ID. */
async function positionsOf(journeyId: string): Promise<PositionAsStored[]> {
  const result = await connection().query<{
    event_id: string;
    latitude: number;
    longitude: number;
    accuracy_m: number;
    recorded_ms: string;
  }>(
    `select h.event_id, p.latitude::float8 as latitude, p.longitude::float8 as longitude,
            p.accuracy_m::float8 as accuracy_m, ${MS('p.recorded_at')} as recorded_ms
       from positions p join heartbeats h on h.id = p.heartbeat_id
      where h.journey_id = $1 order by h.id`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    eventId: row.event_id,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracy_m,
    recordedAt: new Date(Number(row.recorded_ms)),
  }));
}

/** The database's own now, to the millisecond, floored as a Date floors it. */
async function databaseNowMs(): Promise<number> {
  const result = await connection().query<{ ms: string }>(
    'select floor(extract(epoch from now()) * 1000)::bigint::text as ms',
  );
  return Number(result.rows[0]?.ms);
}

/** A moment read back to the millisecond, floored as a Date floors it, or null. */
const momentOf = (ms: string | null | undefined): Date | null =>
  ms === null || ms === undefined ? null : new Date(Number(ms));

/** The journey's alerts, as the `alerts` table holds them (LOST-02). */
async function alertsOf(journeyId: string): Promise<AlertAsStored[]> {
  const result = await connection().query<{
    id: string;
    state: string;
    opened_ms: string;
    silent_ms: string;
  }>(
    `select id::text as id, state::text as state, ${MS('opened_at')} as opened_ms,
            ${MS('silent_since')} as silent_ms
       from alerts where journey_id = $1 order by opened_at, id`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    state: row.state,
    openedAt: new Date(Number(row.opened_ms)),
    silentSince: new Date(Number(row.silent_ms)),
  }));
}

/** The outbox messages of the journey's alerts, as the `outbox` table holds them (LOST-02). */
async function messagesOf(journeyId: string): Promise<MessageAsStored[]> {
  const result = await connection().query<{
    message_id: string;
    alert_id: string;
    recipient_id: string;
    kind: string;
    attempts: number;
    next_ms: string;
    sent_ms: string | null;
    last_failure: string | null;
  }>(
    `select o.id::text as message_id, o.alert_id::text as alert_id,
            o.recipient_id::text as recipient_id, o.kind::text as kind,
            o.attempts::int as attempts, ${MS('o.next_attempt_at')} as next_ms,
            ${MS('o.sent_at')} as sent_ms, o.last_failure::text as last_failure
       from outbox o join alerts a on a.id = o.alert_id
      where a.journey_id = $1 order by o.id`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    messageId: row.message_id,
    alertId: row.alert_id,
    recipientId: row.recipient_id,
    kind: row.kind,
    attempts: row.attempts,
    nextAttemptAt: new Date(Number(row.next_ms)),
    sentAt: momentOf(row.sent_ms),
    lastFailure: row.last_failure,
  }));
}

/** LOST-03: each alert of the journey's resolution, as the `alerts` table holds it. */
async function resolutionsOf(journeyId: string): Promise<ResolutionAsStored[]> {
  const result = await connection().query<{
    id: string;
    resolved_ms: string | null;
    resolution: string | null;
  }>(
    `select id::text as id, ${MS('resolved_at')} as resolved_ms, resolution::text as resolution
       from alerts where journey_id = $1 order by opened_at, id`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    alertId: row.id,
    resolvedAt: momentOf(row.resolved_ms),
    resolution: row.resolution,
  }));
}

/** LOST-03: when each message of the journey's alerts was written, and withdrawn. */
async function withdrawalsOf(journeyId: string): Promise<WithdrawalAsStored[]> {
  const result = await connection().query<{
    message_id: string;
    created_ms: string;
    withdrawn_ms: string | null;
  }>(
    `select o.id::text as message_id, ${MS('o.created_at')} as created_ms,
            ${MS('o.withdrawn_at')} as withdrawn_ms
       from outbox o join alerts a on a.id = o.alert_id
      where a.journey_id = $1 order by o.id`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    messageId: row.message_id,
    createdAt: new Date(Number(row.created_ms)),
    withdrawnAt: momentOf(row.withdrawn_ms),
  }));
}

/** LOST-03: how the journey ended, as the `journeys` table holds it, or null if there is no such journey. */
async function endOf(journeyId: string): Promise<JourneyEndAsStored | null> {
  const result = await connection().query<{ ended_ms: string | null; end_reason: string | null }>(
    `select ${MS('ended_at')} as ended_ms, end_reason::text as end_reason
       from journeys where id = $1`,
    [journeyId],
  );
  const row = result.rows[0];
  return row === undefined ? null : { endedAt: momentOf(row.ended_ms), endReason: row.end_reason };
}

/**
 * LOST-03-AC4: an alert put in directly; the resolution's columns only when it
 * has one. LOST-06: and who acknowledged it and when, only when given, so the
 * behaviours that give neither write exactly the columns they wrote before.
 */
async function seedAlert({
  journeyId,
  state,
  openedAt,
  silentSince,
  resolvedAt = null,
  resolution = null,
  acknowledgedBy = null,
  acknowledgedAt = null,
  smsRaisedAt = null,
  round,
}: {
  journeyId: string;
  state: string;
  openedAt: Date;
  silentSince: Date;
  resolvedAt?: Date | null;
  resolution?: string | null;
  acknowledgedBy?: string | null;
  acknowledgedAt?: Date | null;
  smsRaisedAt?: Date | null;
  round?: number;
}): Promise<string> {
  const id = await seedAlertRow({
    journeyId,
    state,
    openedAt,
    silentSince,
    resolvedAt,
    resolution,
    acknowledgedBy,
    acknowledgedAt,
  });
  // LOST-07: the escalation time, only when given, so the behaviours that give
  // none write exactly the columns they wrote before.
  if (smsRaisedAt !== null) {
    await connection().query('update alerts set sms_raised_at = $2 where id = $1', [
      id,
      smsRaisedAt,
    ]);
  }
  // SM-10: the round, only when given, so the behaviours that give none write
  // exactly the columns they wrote before, and the column's default stands.
  // A round under 1 is refused here by the table's check, as the fake refuses it.
  if (round !== undefined) {
    await connection().query('update alerts set round = $2 where id = $1', [id, round]);
  }
  return id;
}

async function seedAlertRow({
  journeyId,
  state,
  openedAt,
  silentSince,
  resolvedAt,
  resolution,
  acknowledgedBy,
  acknowledgedAt,
}: {
  journeyId: string;
  state: string;
  openedAt: Date;
  silentSince: Date;
  resolvedAt: Date | null;
  resolution: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
}): Promise<string> {
  const id = syntheticUuid();
  if (acknowledgedBy !== null || acknowledgedAt !== null) {
    await connection().query(
      `insert into alerts (id, journey_id, state, opened_at, silent_since, resolved_at, resolution,
                           acknowledged_by, acknowledged_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        journeyId,
        state,
        openedAt,
        silentSince,
        resolvedAt,
        resolution,
        acknowledgedBy,
        acknowledgedAt,
      ],
    );
    return id;
  }
  if (resolvedAt === null && resolution === null) {
    await connection().query(
      `insert into alerts (id, journey_id, state, opened_at, silent_since)
       values ($1, $2, $3, $4, $5)`,
      [id, journeyId, state, openedAt, silentSince],
    );
  } else {
    await connection().query(
      `insert into alerts (id, journey_id, state, opened_at, silent_since, resolved_at, resolution)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, journeyId, state, openedAt, silentSince, resolvedAt, resolution],
    );
  }
  return id;
}

/**
 * LOST-03: an outbox message put in directly, never withdrawn; every column
 * but that one given. LOST-07: withdrawn at `withdrawnAt`, only when given.
 */
async function seedMessage({
  alertId,
  recipientId,
  kind,
  createdAt,
  nextAttemptAt,
  attempts = 0,
  sentAt = null,
  lastFailure = null,
  withdrawnAt = null,
  round,
}: {
  alertId: string;
  recipientId: string;
  kind: string;
  createdAt: Date;
  nextAttemptAt: Date;
  attempts?: number;
  sentAt?: Date | null;
  lastFailure?: string | null;
  withdrawnAt?: Date | null;
  round?: number;
}): Promise<string> {
  const id = syntheticUuid();
  if (round === undefined) {
    await connection().query(
      `insert into outbox (id, alert_id, recipient_id, kind, created_at, attempts,
                           next_attempt_at, sent_at, last_failure)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, alertId, recipientId, kind, createdAt, attempts, nextAttemptAt, sentAt, lastFailure],
    );
  } else {
    // SM-10: the round in the insert itself, only when given: a second
    // message of a kind for the same alert and recipient is taken only in
    // another round, so the unique key must see the round as it is written.
    await connection().query(
      `insert into outbox (id, alert_id, recipient_id, kind, created_at, attempts,
                           next_attempt_at, sent_at, last_failure, round)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        alertId,
        recipientId,
        kind,
        createdAt,
        attempts,
        nextAttemptAt,
        sentAt,
        lastFailure,
        round,
      ],
    );
  }
  if (withdrawnAt !== null) {
    await connection().query('update outbox set withdrawn_at = $2 where id = $1', [
      id,
      withdrawnAt,
    ]);
  }
  return id;
}

/** LOST-07: each alert of the journey's escalation time, as the `alerts` table holds it. */
async function escalationsOf(journeyId: string): Promise<EscalationAsStored[]> {
  const result = await connection().query<{ id: string; sms_raised_ms: string | null }>(
    `select id::text as id, ${MS('sms_raised_at')} as sms_raised_ms
       from alerts where journey_id = $1 order by opened_at, id`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    alertId: row.id,
    smsRaisedAt: momentOf(row.sms_raised_ms),
  }));
}

/** LOST-03-AC4: every responder row of the journey removed directly. */
async function removeResponders(journeyId: string): Promise<void> {
  await connection().query('delete from journey_responders where journey_id = $1', [journeyId]);
}

/** SM-10: each alert of the journey's round, as the `alerts` table holds it. */
async function roundsOf(journeyId: string): Promise<AlertRound[]> {
  const result = await connection().query<{ id: string; round: number }>(
    `select id::text as id, round::int as round
       from alerts where journey_id = $1 order by opened_at, id`,
    [journeyId],
  );
  return result.rows.map((row) => ({ alertId: row.id, round: row.round }));
}

/** SM-10: each message of the journey's alerts' round, as the `outbox` table holds it. */
async function messageRoundsOf(journeyId: string): Promise<MessageRound[]> {
  const result = await connection().query<{ message_id: string; round: number }>(
    `select o.id::text as message_id, o.round::int as round
       from outbox o join alerts a on a.id = o.alert_id
      where a.journey_id = $1 order by o.id`,
    [journeyId],
  );
  return result.rows.map((row) => ({ messageId: row.message_id, round: row.round }));
}

/** SM-10: the journey's own messages, naming it and no alert, as the `outbox` table holds them. */
async function journeyMessagesOf(journeyId: string): Promise<JourneyMessageAsStored[]> {
  const result = await connection().query<{
    message_id: string;
    journey_id: string;
    recipient_id: string;
    kind: string;
    round: number;
    created_ms: string;
    attempts: number;
    next_ms: string;
    sent_ms: string | null;
    last_failure: string | null;
    withdrawn_ms: string | null;
  }>(
    `select id::text as message_id, journey_id::text as journey_id,
            recipient_id::text as recipient_id, kind::text as kind, round::int as round,
            ${MS('created_at')} as created_ms, attempts::int as attempts,
            ${MS('next_attempt_at')} as next_ms, ${MS('sent_at')} as sent_ms,
            last_failure::text as last_failure, ${MS('withdrawn_at')} as withdrawn_ms
       from outbox where journey_id = $1 order by id`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    messageId: row.message_id,
    journeyId: row.journey_id,
    recipientId: row.recipient_id,
    kind: row.kind,
    round: row.round,
    createdAt: new Date(Number(row.created_ms)),
    attempts: row.attempts,
    nextAttemptAt: new Date(Number(row.next_ms)),
    sentAt: momentOf(row.sent_ms),
    lastFailure: row.last_failure,
    withdrawnAt: momentOf(row.withdrawn_ms),
  }));
}

/**
 * SM-10-AC3: holds the journey's row as holdRow does, and lets it go once
 * another session (the removal) is waiting for it, having first changed the
 * journey in its own transaction, as one in flight would: `{ remove }`, that
 * responder's row deleted and nothing else; 'end', the journey ENDED; or
 * 'unchanged', nothing. `release` lets go at once if no one came to wait.
 */
async function holdUntilRemovalWaits(
  journeyId: string,
  change: 'unchanged' | 'end' | { remove: string },
): Promise<{ release: () => Promise<void> }> {
  const client = await connection().connect();
  await client.query('begin');
  await client.query('select id from journeys where id = $1 for update', [journeyId]);
  const pid = (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid;
  // An object, so the loop reads the flag release() sets, not a narrowed copy.
  const state = { stopped: false };
  const lettingGo = (async () => {
    try {
      while (!state.stopped) {
        const waiting = await connection().query<{ n: number }>(
          'select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
          [pid],
        );
        if ((waiting.rows[0]?.n ?? 0) > 0) {
          if (change === 'end') {
            await client.query("update journeys set state = 'ENDED' where id = $1", [journeyId]);
          } else if (change !== 'unchanged') {
            await client.query(
              'delete from journey_responders where journey_id = $1 and responder_id = $2',
              [journeyId, change.remove],
            );
          }
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await client.query('commit');
    } finally {
      client.release();
    }
  })();
  return {
    release: async () => {
      state.stopped = true;
      await lettingGo;
    },
  };
}

/** LOST-06: who is on each alert of the journey, and since when, as the `alerts` table holds it. */
async function acknowledgementsOf(journeyId: string): Promise<AcknowledgementAsStored[]> {
  const result = await connection().query<{
    id: string;
    acknowledged_by: string | null;
    acknowledged_ms: string | null;
  }>(
    `select id::text as id, acknowledged_by::text as acknowledged_by,
            ${MS('acknowledged_at')} as acknowledged_ms
       from alerts where journey_id = $1 order by opened_at, id`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    alertId: row.id,
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: momentOf(row.acknowledged_ms),
  }));
}

/**
 * Holds the journey's row `for update` in a transaction of its own, on a
 * connection of its own, until released: a heartbeat being written, or
 * another worker's sweep (LOST-02-AC8).
 */
async function holdRow(journeyId: string): Promise<{ release: () => Promise<void> }> {
  const client = await connection().connect();
  await client.query('begin');
  await client.query('select id from journeys where id = $1 for update', [journeyId]);
  return {
    release: async () => {
      try {
        await client.query('commit');
      } finally {
        client.release();
      }
    },
  };
}

/**
 * Holds the journey's row as holdRow does, and lets it go once another
 * session is waiting for it: a healthy transaction that commits within the
 * lock wait (LOST-02-AC20). With 'contact', the holder first moves the
 * journey's last contact to its own now(), as a heartbeat in flight does.
 * `release` lets go at once if no one came to wait.
 */
async function holdUntilWaited(
  journeyId: string,
  change: 'unchanged' | 'contact',
): Promise<{ release: () => Promise<void> }> {
  const client = await connection().connect();
  await client.query('begin');
  await client.query('select id from journeys where id = $1 for update', [journeyId]);
  const pid = (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid;
  // An object, so the loop reads the flag release() sets, not a narrowed copy.
  const state = { stopped: false };
  const lettingGo = (async () => {
    try {
      while (!state.stopped) {
        const waiting = await connection().query<{ n: number }>(
          'select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
          [pid],
        );
        if ((waiting.rows[0]?.n ?? 0) > 0) {
          if (change === 'contact') {
            await client.query('update journeys set last_heartbeat_at = now() where id = $1', [
              journeyId,
            ]);
          }
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await client.query('commit');
    } finally {
      client.release();
    }
  })();
  return {
    release: async () => {
      state.stopped = true;
      await lettingGo;
    },
  };
}

/**
 * LOST-07-AC16: holds the journey's row as holdRow does, and lets it go once
 * another session (the escalation) is waiting for it, having first changed
 * the journey's unresolved alert in its own transaction, as one in flight
 * would: 'acknowledge', recorded by the journey's first responder at its
 * now(), as "I'm on it" committing; 'resolve', resolved with contact back and
 * the journey ACTIVE again at its now(), as a heartbeat committing;
 * 'unchanged', nothing. `release` lets go at once if no one came to wait.
 */
async function holdUntilEscalationWaits(
  journeyId: string,
  change: 'unchanged' | 'acknowledge' | 'resolve',
): Promise<{ release: () => Promise<void> }> {
  const client = await connection().connect();
  await client.query('begin');
  await client.query('select id from journeys where id = $1 for update', [journeyId]);
  const pid = (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid;
  // An object, so the loop reads the flag release() sets, not a narrowed copy.
  const state = { stopped: false };
  const lettingGo = (async () => {
    try {
      while (!state.stopped) {
        const waiting = await connection().query<{ n: number }>(
          'select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
          [pid],
        );
        if ((waiting.rows[0]?.n ?? 0) > 0) {
          if (change === 'acknowledge') {
            await client.query(
              `update alerts
                  set state = 'ACKNOWLEDGED', acknowledged_at = now(),
                      acknowledged_by = (select responder_id from journey_responders
                                          where journey_id = $1 order by responder_id limit 1)
                where journey_id = $1 and state <> 'RESOLVED'`,
              [journeyId],
            );
          }
          if (change === 'resolve') {
            await client.query(
              `update alerts
                  set state = 'RESOLVED', resolved_at = now(), resolution = 'BACK_IN_CONTACT'
                where journey_id = $1 and state <> 'RESOLVED'`,
              [journeyId],
            );
            await client.query(
              "update journeys set state = 'ACTIVE', last_heartbeat_at = now() where id = $1",
              [journeyId],
            );
          }
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await client.query('commit');
    } finally {
      client.release();
    }
  })();
  return {
    release: async () => {
      state.stopped = true;
      await lettingGo;
    },
  };
}

/**
 * LOST-08-AC4: holds the journey's row as holdRow does, and lets it go once
 * another session (the close) is waiting for it, having first changed the
 * journey in its own transaction, as one in flight would: `{ remove }`, that
 * responder's row deleted and nothing else, as a removal committing;
 * 'contact', its unresolved alert resolved BACK_IN_CONTACT and the journey
 * ACTIVE at its now(), as a heartbeat committing; 'home', resolved HOME and
 * the journey ENDED, HOME, at its now(), as "I'm home" committing; 'expire',
 * resolved EXPIRED and the journey ENDED, EXPIRED, as the 24-hour end
 * committing; 'unchanged', nothing. `release` lets go at once if no one came
 * to wait.
 */
async function holdUntilClosureWaits(
  journeyId: string,
  change: 'unchanged' | 'contact' | 'home' | 'expire' | { remove: string },
): Promise<{ release: () => Promise<void> }> {
  const client = await connection().connect();
  await client.query('begin');
  await client.query('select id from journeys where id = $1 for update', [journeyId]);
  const pid = (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid;
  // An object, so the loop reads the flag release() sets, not a narrowed copy.
  const state = { stopped: false };
  const resolveAs = async (resolution: string) => {
    await client.query(
      `update alerts set state = 'RESOLVED', resolved_at = now(), resolution = $2
        where journey_id = $1 and state <> 'RESOLVED'`,
      [journeyId, resolution],
    );
  };
  const lettingGo = (async () => {
    try {
      while (!state.stopped) {
        const waiting = await connection().query<{ n: number }>(
          'select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
          [pid],
        );
        if ((waiting.rows[0]?.n ?? 0) > 0) {
          if (change === 'contact') {
            await resolveAs('BACK_IN_CONTACT');
            await client.query(
              "update journeys set state = 'ACTIVE', last_heartbeat_at = now() where id = $1",
              [journeyId],
            );
          } else if (change === 'home' || change === 'expire') {
            const reason = change === 'home' ? 'HOME' : 'EXPIRED';
            await resolveAs(reason);
            await client.query(
              "update journeys set state = 'ENDED', ended_at = now(), end_reason = $2 where id = $1",
              [journeyId, reason],
            );
          } else if (change !== 'unchanged') {
            await client.query(
              'delete from journey_responders where journey_id = $1 and responder_id = $2',
              [journeyId, change.remove],
            );
          }
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  })();
  // Its failure is the behaviour's, read through release(); never unhandled meanwhile.
  lettingGo.catch(() => undefined);
  return {
    release: async () => {
      state.stopped = true;
      await lettingGo;
    },
  };
}

/** An advisory lock key of its own: one per arrangement, so two never share a turnstile. */
const advisoryKey = () => Math.floor(Math.random() * 1_000_000_000) + 1;

/** Whether a session is waiting for this advisory lock right now. */
async function someoneWaitsOn(key: number): Promise<boolean> {
  const result = await connection().query<{ n: number }>(
    `select count(*)::int as n from pg_locks
      where locktype = 'advisory' and classid = 0 and objid = $1 and objsubid = 1 and not granted`,
    [key],
  );
  return (result.rows[0]?.n ?? 0) > 0;
}

/**
 * LOST-08-AC21: arranges the next start to race ends from outside the
 * walker's phone, on the real tables. Two test-only triggers on `journeys`
 * make turnstiles a session of the test's own holds shut:
 *   - after an insert statement that stored no row (the one-unended-journey
 *     index refused it, `on conflict do nothing`), the start's transaction
 *     waits at the conflict turnstile, before it reads which journey won;
 *     `end` then runs through the store, on other connections, and commits;
 *   - with `again`, before an ACTIVE row is inserted for a walker with no
 *     unended journey (the retry, once the first journey has ended), it waits
 *     at the retry turnstile; `again.before` then puts in another unended
 *     journey of the walker's, and `again.end` ends it at the conflict
 *     turnstile, as before.
 * Each wait is seen in pg_locks, never guessed by a sleep. A start that never
 * comes to a turnstile (the adapter before this task, which does not retry)
 * leaves the arrangement waiting until `done`, which opens every turnstile,
 * drops the triggers and reports any failure of the arrangement's own.
 */
async function raceTheStart(race: {
  end: () => Promise<unknown>;
  again?: { before: () => Promise<unknown>; end: () => Promise<unknown> };
}): Promise<{ done: () => Promise<void> }> {
  const conflict = advisoryKey();
  const retry = advisoryKey();
  const name = 'lost08_race_the_start';
  const gateKeeper = await connection().connect();
  await gateKeeper.query('select pg_advisory_lock($1)', [conflict]);
  const create = [
    `create function ${name}_conflict() returns trigger language plpgsql as $$
       begin
         if (select count(*) from inserted) = 0 then
           perform pg_advisory_lock(${String(conflict)});
           perform pg_advisory_unlock(${String(conflict)});
         end if;
         return null;
       end
     $$`,
    `create trigger ${name}_conflict after insert on journeys
       referencing new table as inserted for each statement
       execute function ${name}_conflict()`,
  ];
  const drop = [
    `drop trigger if exists ${name}_conflict on journeys`,
    `drop function if exists ${name}_conflict()`,
    `drop trigger if exists ${name}_retry on journeys`,
    `drop function if exists ${name}_retry()`,
  ];
  if (race.again !== undefined) {
    await gateKeeper.query('select pg_advisory_lock($1)', [retry]);
    create.push(
      `create function ${name}_retry() returns trigger language plpgsql as $$
         begin
           if not exists (select 1 from journeys
                           where walker_id = new.walker_id and state <> 'ENDED') then
             perform pg_advisory_lock(${String(retry)});
             perform pg_advisory_unlock(${String(retry)});
           end if;
           return new;
         end
       $$`,
      `create trigger ${name}_retry before insert on journeys for each row
         when (new.state = 'ACTIVE') execute function ${name}_retry()`,
    );
  }
  for (const statement of create) {
    await connection().query(statement);
  }
  const state: { stopped: boolean; failure: unknown } = { stopped: false, failure: undefined };
  const waitedOn = async (key: number): Promise<boolean> => {
    while (!state.stopped) {
      if (await someoneWaitsOn(key)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return false;
  };
  const driving = (async () => {
    try {
      if (!(await waitedOn(conflict))) {
        return;
      }
      await race.end();
      await gateKeeper.query('select pg_advisory_unlock($1)', [conflict]);
      if (race.again === undefined) {
        return;
      }
      // Shut again behind the start that just went through, for its retry.
      await gateKeeper.query('select pg_advisory_lock($1)', [conflict]);
      if (!(await waitedOn(retry))) {
        return;
      }
      await race.again.before();
      await gateKeeper.query('select pg_advisory_unlock($1)', [retry]);
      if (!(await waitedOn(conflict))) {
        return;
      }
      await race.again.end();
      await gateKeeper.query('select pg_advisory_unlock($1)', [conflict]);
    } catch (error) {
      state.failure = error;
    }
  })();
  return {
    done: async () => {
      state.stopped = true;
      try {
        await gateKeeper.query('select pg_advisory_unlock_all()');
        await driving;
      } finally {
        gateKeeper.release();
        for (const statement of drop) {
          await connection().query(statement);
        }
      }
      if (state.failure !== undefined) {
        throw state.failure instanceof Error
          ? state.failure
          : new Error('the start’s race arrangement failed');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The API, with every real adapter.
// ---------------------------------------------------------------------------

function realApi(log: FakeLog = fakeLog()) {
  const clock = databaseClock(database());
  return createApi({
    health: createHealthService({ clock, heartbeats: databaseWorkerHeartbeats(database()) }),
    journeys: createJourneyService({ clock, journeys: databaseJourneyStore(database()), log }),
    devices: databaseDeviceAuthenticator(database()),
    // RG-03 (LOST-06, the spec's "Existing assertions that change by
    // design"): `acknowledgements` added because "I'm on it" (D-114) made it
    // part of what the API needs. These tests acknowledge nothing, so it
    // rejects; they never call it, and nothing they assert changes.
    acknowledgements: {
      acknowledge: () => Promise.reject(new Error('these tests acknowledge nothing')),
    },
    // RG-03 (LOST-08; not in the spec's "Existing assertions that change by
    // design", which names no ApiDependencies stand-in): `closures` added
    // because "They're safe" (approach item 5; "Interfaces": ApiDependencies
    // gains `closures`) made it part of what the API needs. These tests close
    // nothing, so it rejects; they never call it, and nothing they assert
    // changes.
    closures: {
      close: () => Promise.reject(new Error('these tests close nothing')),
    },
  });
}

async function start(
  credential: string,
  body: unknown,
  api = realApi(),
): Promise<{ status: number; body: unknown; text: string }> {
  const response = await api.request(apiPath('journeys'), {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: parsedOrNull(text), text };
}

function parsedOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface StartedBody {
  journeyId: string;
  state: string;
  startedAt: string;
}

interface ErrorBody {
  code?: unknown;
  data?: { journeyId?: unknown };
}

// ---------------------------------------------------------------------------
// The adapter keeps the same rules as the fake the system tests run on.
// ---------------------------------------------------------------------------

describe('databaseJourneyStore, against the behaviour every journey store shares', () => {
  const underTest = (): JourneyStoreUnderTest => ({
    store: databaseJourneyStore(database()),
    addUser,
    addDevice: async (userId) => (await addDevice(userId)).deviceId,
    seedJourney,
    journeysOf,
    endJourney,
    deviceOf,
    stateOf,
    lastHeartbeatAt,
    heartbeatsOf,
    positionsOf,
    // Each run writes real rows, so fewer than against the fake.
    propertyRuns: 15,
    // LOST-02: the watchdog's and the outbox's side, read straight from the
    // tables, and the database's own now().
    now: async () => new Date(await databaseNowMs()),
    alertsOf,
    messagesOf,
    hold: holdRow,
    holdUntilWaited,
    // Short, so the open of a row held throughout costs a behaviour a second.
    lockWaitMs: 1_000,
    // The database's now() moves on by itself: the behaviour waits.
    letTimePass: (ms) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
    // now() moves on while a behaviour runs: a silence this close to the
    // threshold could fall either side of it by the time the store asks.
    timeMarginMs: 2_000,
    // LOST-03: an alert's resolution, a message's withdrawal and a journey's
    // end, each read by a reader of its own; and the rows a behaviour puts in
    // directly.
    resolutionsOf,
    withdrawalsOf,
    endOf,
    seedAlert,
    seedMessage,
    removeResponders,
    // LOST-06: who is on each alert, read by a reader of its own.
    acknowledgementsOf,
    // LOST-07: when each alert escalated, read by a reader of its own; and a
    // holder that changes the alert as an acknowledgement or a heartbeat
    // committing would, once the escalation waits.
    escalationsOf,
    holdUntilEscalationWaits,
    // SM-10: each alert's and message's round and the journey's own
    // messages, each read by a reader of its own, so alertsOf and messagesOf
    // keep their shapes; and a holder that changes the journey as a removal
    // or an end committing would, once the removal waits.
    roundsOf,
    messageRoundsOf,
    journeyMessagesOf,
    holdUntilRemovalWaits,
    // LOST-08: a holder that changes the journey as a removal, a heartbeat,
    // "I'm home" or the 24-hour end committing would, once the close waits;
    // and the turnstiles that put a close or the 24-hour end between a
    // start's conflict and its read.
    holdUntilClosureWaits,
    raceTheStart,
  });

  test.each(JOURNEY_STORE_BEHAVIOUR)(
    '$name',
    async ({ name, run }) => {
      // LOST-02: a claim takes the due messages of the whole table, and other
      // behaviours leave theirs due. So before each of the outbox's
      // behaviours, every message already there is put out of reach, as sent;
      // only LOST-02's behaviours touch the outbox, and only they need it.
      // LOST-03's behaviours claim too, and write stand-downs that are due,
      // so they get the same start (added, not changed).
      // LOST-06's claim as well, and write notices and stand-downs that are
      // due: the same start again (added, not changed).
      // LOST-07's claim both channels and count the unsent SMS of the whole
      // table: the same start again (added, not changed).
      // SM-10's claim too (the warning, AC14), and write warnings, notices
      // and SMS that are due: the same start again (added, not changed).
      // LOST-08's write stand-downs that are due, and the open's withdrawal
      // reads the whole table: the same start again (added, not changed).
      if (
        name.startsWith('LOST-02-') ||
        name.startsWith('LOST-03-') ||
        name.startsWith('LOST-06-') ||
        name.startsWith('LOST-07-') ||
        name.startsWith('SM-10-') ||
        name.startsWith('LOST-08-')
      ) {
        await connection().query('update outbox set sent_at = now() where sent_at is null');
      }
      await run(underTest());
    },
    120_000,
  );
});

// ---------------------------------------------------------------------------
// SM-01, end to end on the real tables.
// ---------------------------------------------------------------------------

describe('SM-01: starting a journey, on the real tables', () => {
  test('SM-01-AC1: a walker with a responder starts one: 201 in the contract’s shape, stored ACTIVE with exactly that responder, timed by the database', async () => {
    const device = await walker();
    const responderId = await addUser();

    const before = await databaseNowMs();
    const answer = await start(device.credential, { responderIds: [responderId] });
    const after = await databaseNowMs();

    expect(answer.status).toBe(201);
    expect(startJourneyResponseSchema.safeParse(answer.body).success).toBe(true);
    const { journeyId, state, startedAt } = answer.body as StartedBody;
    expect(state).toBe('ACTIVE');
    expect(await journeysOf(device.userId)).toEqual([
      {
        id: journeyId,
        walkerId: device.userId,
        state: 'ACTIVE',
        startedAt: new Date(startedAt),
        responderIds: [responderId],
      },
    ]);
    // Bracketed by two readings of the database's own clock: a time taken
    // from this machine could fall outside them, and one taken from anywhere
    // else would not be the time the watchdog will count silence from.
    expect(Date.parse(startedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(startedAt)).toBeLessThanOrEqual(after);
  });

  test('SM-01-AC2: a walker whose journey is in LOST_CONTACT, put there directly, is reported by the adapter and refused 409 with it; nothing changes', async () => {
    const device = await walker();
    const earlier = await addUser();
    const later = await addUser();
    const journeyId = await seedJourney({
      walkerId: device.userId,
      deviceId: device.deviceId,
      state: 'LOST_CONTACT',
      responderIds: [earlier],
      startedAt: EARLIER,
    });

    expect(await databaseJourneyStore(database()).unendedJourneyOf(device.userId)).toEqual({
      id: journeyId,
      state: 'LOST_CONTACT',
    });
    const before = await journeysOf(device.userId);

    const answer = await start(device.credential, { responderIds: [later] });

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ code: 'ALREADY_ON_A_JOURNEY', data: { journeyId } });
    expect(await journeysOf(device.userId)).toEqual(before);
  });

  test(`SM-01-AC3: ${String(RACERS)} starts at once on separate connections, ${String(RACE_ROUNDS)} times over: one 201, every other 409 with its ID, none an error`, async () => {
    const api = realApi();

    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const device = await walker();
      const responderId = await addUser();

      const answers = await Promise.all(
        Array.from({ length: RACERS }, () =>
          start(device.credential, { responderIds: [responderId] }, api),
        ),
      );

      const created = answers.filter((answer) => answer.status === 201);
      expect(created, `round ${String(round)}`).toHaveLength(1);
      const winner = (created[0]?.body as StartedBody | undefined)?.journeyId;
      expect(
        answers
          .filter((answer) => answer.status !== 201)
          .map((answer) => ({
            status: answer.status,
            code: (answer.body as ErrorBody | null)?.code,
            journeyId: (answer.body as ErrorBody | null)?.data?.journeyId,
          })),
        `round ${String(round)}`,
      ).toEqual(
        Array.from({ length: RACERS - 1 }, () => ({
          status: 409,
          code: 'ALREADY_ON_A_JOURNEY',
          journeyId: winner,
        })),
      );
      const unended = await connection().query<{ id: string }>(
        "select id::text as id from journeys where walker_id = $1 and state <> 'ENDED'",
        [device.userId],
      );
      expect(unended.rows, `round ${String(round)}`).toEqual([{ id: winner }]);
    }
  }, 120_000);

  test.each(UNENDED_STATES)(
    'SM-01-AC3: beside a journey in %s, the database itself refuses a second journey in every state but ENDED, and allows an ENDED one',
    async (existing) => {
      // The backstop, without the adapter in the way: if the index were
      // missing, the races above could pass by luck and then fail on a phone.
      // Every state the module lists but ENDED, read from the list rather
      // than written out, so a state added later is tried here the day it is
      // added, on both sides of the pair.
      const { userId: walkerId, deviceId } = await walker();
      await seedJourney({
        walkerId,
        deviceId,
        state: existing,
        responderIds: [],
        startedAt: EARLIER,
      });

      for (const second of UNENDED_STATES) {
        await expect(
          seedJourney({ walkerId, deviceId, state: second, responderIds: [], startedAt: EARLIER }),
          `${existing} then ${second}`,
        ).rejects.toMatchObject({ code: '23505', constraint: ONE_UNENDED_INDEX });
      }
      await expect(
        seedJourney({ walkerId, deviceId, state: 'ENDED', responderIds: [], startedAt: EARLIER }),
      ).resolves.toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    },
  );

  test('SM-01-AC3: the index names the one state that frees the walker, not the states that block, so a state added later blocks by default', async () => {
    // The test above tries today's states. An index written as an allow-list
    // of blocking states would pass it, and then let a walker in a state
    // added later start a second journey: two journeys splitting one walker's
    // heartbeats, one of them watched for a silence that is really the
    // other's. So the predicate itself is read back from the database.
    const result = await connection().query<{ definition: string }>(
      'select pg_get_indexdef($1::regclass) as definition',
      [ONE_UNENDED_INDEX],
    );
    const definition = result.rows[0]?.definition ?? '';

    expect(definition).toMatch(/^CREATE UNIQUE INDEX /);
    expect(definition).toContain('(walker_id)');
    expect(definition).toContain("<> 'ENDED'");
    expect(definition).toMatch(/ WHERE \(state <> 'ENDED'(::[\w."]+)?\)$/);
  });

  test('SM-01-AC4: a walker whose only journey is ENDED, put there directly, starts a new one; the ended one is unchanged', async () => {
    const device = await walker();
    const earlier = await addUser();
    const later = await addUser();
    const endedId = await seedJourney({
      walkerId: device.userId,
      deviceId: device.deviceId,
      state: 'ENDED',
      responderIds: [earlier],
      startedAt: EARLIER,
    });
    const [ended] = await journeysOf(device.userId);

    const answer = await start(device.credential, { responderIds: [later] });

    expect(answer.status).toBe(201);
    const { journeyId, startedAt } = answer.body as StartedBody;
    const journeys = await journeysOf(device.userId);
    expect(journeys).toHaveLength(2);
    expect(journeys.find((journey) => journey.id === endedId)).toEqual(ended);
    expect(journeys.find((journey) => journey.id === journeyId)).toEqual({
      id: journeyId,
      walkerId: device.userId,
      state: 'ACTIVE',
      startedAt: new Date(startedAt),
      responderIds: [later],
    });
  });
});

describe('SM-02: responders are users other than the walker, checked against the real users table', () => {
  test('SM-01-AC6: an ID with no row in users is 422 INVALID_RESPONDER, alone or beside a real one, and nothing is stored', async () => {
    const device = await walker();
    const responderId = await addUser();

    for (const responderIds of [[syntheticUuid()], [responderId, syntheticUuid()]]) {
      const answer = await start(device.credential, { responderIds });

      expect(answer.status).toBe(422);
      expect((answer.body as ErrorBody).code).toBe('INVALID_RESPONDER');
    }
    expect(await journeysOf(device.userId)).toEqual([]);
  });

  test('SM-01-AC6: the walker naming themself is 422 INVALID_RESPONDER, and nothing is stored', async () => {
    const device = await walker();
    const responderId = await addUser();

    const answer = await start(device.credential, { responderIds: [responderId, device.userId] });

    expect(answer.status).toBe(422);
    expect((answer.body as ErrorBody).code).toBe('INVALID_RESPONDER');
    expect(await journeysOf(device.userId)).toEqual([]);
  });

  test('SM-01-AC6: an existing responder named in upper case is that user: 201, and the row holds the ID lower-case', async () => {
    // PostgreSQL reads a UUID in either case and hands it back lower-case;
    // the start rule compares IDs as strings. Unless the edge makes them one
    // case, a real user named in upper case is refused as INVALID_RESPONDER.
    const device = await walker();
    const responderId = await addUser();
    expect(responderId).toBe(responderId.toLowerCase());

    const answer = await start(device.credential, { responderIds: [responderId.toUpperCase()] });

    expect(answer.status).toBe(201);
    const { journeyId } = answer.body as StartedBody;
    const rows = await connection().query<{ responder_id: string }>(
      'select responder_id::text as responder_id from journey_responders where journey_id = $1',
      [journeyId],
    );
    expect(rows.rows).toEqual([{ responder_id: responderId }]);
  });

  test('SM-01-AC6: a responder named twice is one responder row', async () => {
    const device = await walker();
    const responderId = await addUser();

    const answer = await start(device.credential, { responderIds: [responderId, responderId] });

    expect(answer.status).toBe(201);
    const { journeyId } = answer.body as StartedBody;
    const rows = await connection().query<{ responder_id: string }>(
      'select responder_id::text as responder_id from journey_responders where journey_id = $1',
      [journeyId],
    );
    expect(rows.rows).toEqual([{ responder_id: responderId }]);
  });
});

describe('SM-01: a journey never exists without its responders', () => {
  test('SM-01-AC8: when writing a responder row fails, the answer is 500, not 201, and no journey row is left', async () => {
    const device = await walker();
    const responderId = await addUser();
    // A trigger this test creates in its own database, and removes again,
    // so the failure falls exactly between the journey row and its
    // responders: the moment a missing transaction would show.
    await connection().query(
      `create function refuse_responder_rows() returns trigger language plpgsql as $$
         begin
           raise exception 'responder rows refused by a test trigger';
         end
       $$`,
    );
    await connection().query(
      'create trigger refuse_responder_rows before insert on journey_responders ' +
        'for each row execute function refuse_responder_rows()',
    );

    try {
      const answer = await start(device.credential, { responderIds: [responderId] });

      expect(answer.status).toBe(500);
      expect(answer.text).not.toContain('refused by a test trigger');
      const counted = await connection().query<{ n: number }>(
        'select count(*)::int as n from journeys where walker_id = $1',
        [device.userId],
      );
      expect(counted.rows[0]?.n).toBe(0);
    } finally {
      await connection().query(
        'drop trigger if exists refuse_responder_rows on journey_responders',
      );
      await connection().query('drop function if exists refuse_responder_rows()');
    }

    // And with the fault gone, the same walker starts normally: nothing
    // half-written was left to block them.
    expect((await start(device.credential, { responderIds: [responderId] })).status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// What a fresh deploy holds, and which states the database admits.
// ---------------------------------------------------------------------------

function withDatabase(uri: string, name: string): string {
  const url = new URL(uri);
  url.pathname = `/${name}`;
  return url.toString();
}

describe('SM-01: before the login task, nobody can get a credential', () => {
  test('SM-01-AC13: a freshly migrated database, as staging gets on deploy, has no users, devices, journeys or responders', async () => {
    const name = `fresh_${syntheticUuid().replaceAll('-', '')}`;
    await connection().query(`create database ${name}`);
    const freshUri = withDatabase(connectionUri(), name);

    try {
      await migrateDatabase(freshUri);
      const client = new pg.Client({ connectionString: freshUri });
      await client.connect();
      try {
        const counts: Record<string, number | undefined> = {};
        for (const table of ['users', 'devices', 'journeys', 'journey_responders']) {
          const result = await client.query<{ n: number }>(
            `select count(*)::int as n from ${table}`,
          );
          counts[table] = result.rows[0]?.n;
        }
        expect(counts).toEqual({ users: 0, devices: 0, journeys: 0, journey_responders: 0 });
      } finally {
        await client.end();
      }
    } finally {
      await connection().query(`drop database if exists ${name}`);
    }
  });
});

/** The states the journeys.state column admits: an enum's labels, or a check's literals. */
async function allowedStates(): Promise<string[]> {
  const column = await connection().query<{ typtype: string; typid: string }>(
    `select t.typtype::text as typtype, t.oid::text as typid
       from pg_attribute a
       join pg_type t on t.oid = a.atttypid
      where a.attrelid = 'journeys'::regclass and a.attname = 'state' and not a.attisdropped`,
  );
  const [row] = column.rows;
  if (row === undefined) {
    throw new Error('journeys has no state column');
  }
  if (row.typtype === 'e') {
    const labels = await connection().query<{ label: string }>(
      'select enumlabel as label from pg_enum where enumtypid = $1::oid order by enumsortorder',
      [row.typid],
    );
    return labels.rows.map((label) => label.label);
  }
  const checks = await connection().query<{ definition: string }>(
    `select pg_get_constraintdef(oid) as definition
       from pg_constraint
      where conrelid = 'journeys'::regclass and contype = 'c'`,
  );
  const onState = checks.rows
    .map((check) => check.definition)
    .filter((definition) => /\bstate\b/.test(definition));
  if (onState.length === 0) {
    throw new Error(
      'journeys.state is limited by neither an enum nor a check, so any text would be a state',
    );
  }
  return [
    ...new Set(
      onState.flatMap((definition) =>
        [...definition.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? ''),
      ),
    ),
  ];
}

describe('AR-04: the database and the state machine agree on the states', () => {
  test('SM-01-AC15: the states journeys.state admits are exactly JOURNEY_STATES', async () => {
    expect([...(await allowedStates())].sort()).toEqual([...JOURNEY_STATES].sort());
  });

  test('SM-01-AC15: every listed state is accepted by the database, and a state outside the list is refused', async () => {
    // Each row names a device that exists (D-101), so the state is the only
    // thing a refused row can be refused for.
    for (const state of JOURNEY_STATES) {
      const { userId: walkerId, deviceId } = await walker();
      await expect(
        connection().query(
          'insert into journeys (id, walker_id, device_id, state, started_at) ' +
            'values ($1, $2, $3, $4, now())',
          [syntheticUuid(), walkerId, deviceId, state],
        ),
        state,
      ).resolves.toBeDefined();
    }
    for (const state of ['PAUSED', 'ended', 'active', '']) {
      const { userId: walkerId, deviceId } = await walker();
      await expect(
        connection().query(
          'insert into journeys (id, walker_id, device_id, state, started_at) ' +
            'values ($1, $2, $3, $4, now())',
          [syntheticUuid(), walkerId, deviceId, state],
        ),
        state,
      ).rejects.toThrow();
    }
  });
});

// ===========================================================================
// LOST-01: the heartbeat, on the real tables.
// ===========================================================================

const HEARTBEAT_AT = new Date('2026-10-01T21:40:00.000Z');
const HOUR = 3_600_000;

/** A heartbeat sent through the API with every real adapter, as the phone sends it. */
async function heartbeatThroughApi(
  credential: string,
  body: unknown,
  api = realApi(),
): Promise<{ status: number; body: unknown; text: string; headers: string }> {
  const response = await api.request(apiPath('heartbeats'), {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: parsedOrNull(text),
    text,
    headers: [...response.headers].map(([name, value]) => `${name}: ${value}`).join('\n'),
  };
}

/** A walker with a device, and an ACTIVE journey of theirs started from it, put in directly. */
async function walking(lastHeartbeatAt: Date | null = null) {
  const device = await walker();
  const journeyId = await seedJourney({
    walkerId: device.userId,
    deviceId: device.deviceId,
    state: 'ACTIVE',
    responderIds: [await addUser()],
    startedAt: EARLIER,
    lastHeartbeatAt,
  });
  return { device, journeyId };
}

/** A heartbeat as the store takes it, received at HEARTBEAT_AT unless given. */
function storeHeartbeat(
  journeyId: string,
  given: Partial<HeartbeatToRecord> = {},
): HeartbeatToRecord {
  return {
    journeyId,
    eventId: syntheticEventId(),
    receivedAt: HEARTBEAT_AT,
    batteryLevel: syntheticBatteryLevel(),
    position: toStoredPosition(syntheticPosition()),
    ...given,
  };
}

// `markersOf(heartbeat)`, every text a careless line could print of a
// heartbeat, `markersIn(text, markers)`, and `captured(run)`, everything
// written to stdout, stderr or the console while `run` runs and a turn
// after it, come from ../capture.test.ts. The system tests use the same
// copy, and its controls run here too, so the capture this file relies on
// is proven in this file's own run.

/** A heartbeat body for the API from a store-shaped one: the phone's time as RFC 3339. */
function bodyOf(heartbeat: HeartbeatToRecord): SyntheticHeartbeat {
  return {
    journeyId: heartbeat.journeyId,
    eventId: heartbeat.eventId,
    batteryLevel: heartbeat.batteryLevel,
    position:
      heartbeat.position === null
        ? null
        : { ...heartbeat.position, recordedAt: heartbeat.position.recordedAt.toISOString() },
  };
}

/** All of an error, as deep as it goes: its own properties, hidden ones included, and every cause. */
function everythingIn(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 20; depth += 1) {
    parts.push(inspect(current, { depth: Infinity, showHidden: true }));
    if (current instanceof Error) {
      // A const, so the narrowing to Error holds inside the callback below.
      const failure = current;
      parts.push(String(failure), failure.stack ?? '');
      parts.push(
        JSON.stringify(
          Object.fromEntries(
            Object.getOwnPropertyNames(failure).map((name) => [
              name,
              String(Reflect.get(failure, name) as unknown),
            ]),
          ),
        ),
      );
      current = failure.cause;
    } else {
      current = undefined;
    }
  }
  return parts.join('\n');
}

describe('SM-08, SM-09 and REL-01: a heartbeat stored once, in database-time order, on the real tables', () => {
  test('LOST-01-AC1: a heartbeat through the API with every real adapter is 200 RECORDED: one heartbeat and one position as sent, received at the database’s time between two readings of now(), and last contact that same time', async () => {
    const device = await walker();
    const started = await start(device.credential, { responderIds: [await addUser()] });
    expect(started.status).toBe(201);
    const { journeyId } = started.body as StartedBody;
    const body = syntheticHeartbeat({ journeyId, position: syntheticPosition() });

    const before = await databaseNowMs();
    const answer = await heartbeatThroughApi(device.credential, body);
    const after = await databaseNowMs();

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ outcome: 'RECORDED' });
    const stored = await heartbeatsOf(journeyId);
    expect(stored.map(({ eventId, batteryLevel }) => ({ eventId, batteryLevel }))).toEqual([
      { eventId: body.eventId, batteryLevel: body.batteryLevel },
    ]);
    const receivedAt = stored[0]?.receivedAt.getTime() ?? Number.NaN;
    expect(receivedAt).toBeGreaterThanOrEqual(before);
    expect(receivedAt).toBeLessThanOrEqual(after);
    expect((await lastHeartbeatAt(journeyId))?.getTime()).toBe(receivedAt);
    expect(await positionsOf(journeyId)).toEqual(
      body.position === null
        ? []
        : [
            {
              eventId: body.eventId,
              latitude: body.position.latitude,
              longitude: body.position.longitude,
              accuracyMeters: body.position.accuracyMeters,
              recordedAt: new Date(body.position.recordedAt),
            },
          ],
    );
    expect(await stateOf(journeyId)).toBe('ACTIVE');
  });

  test(`LOST-01-AC4: ${String(RACERS)} copies of one heartbeat at once through the API, on separate connections, ${String(RACE_ROUNDS)} times over: one RECORDED, every other DUPLICATE, none an error; one heartbeat and one position`, async () => {
    const api = realApi();

    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const { device, journeyId } = await walking();
      const body = syntheticHeartbeat({ journeyId, position: syntheticPosition() });

      const answers = await Promise.all(
        Array.from({ length: RACERS }, () => heartbeatThroughApi(device.credential, body, api)),
      );

      expect(
        answers.map((answer) => answer.status),
        `round ${String(round)}`,
      ).toEqual(answers.map(() => 200));
      expect(
        answers.map((answer) => (answer.body as { outcome?: string } | null)?.outcome).sort(),
        `round ${String(round)}`,
      ).toEqual(['RECORDED', ...Array.from({ length: RACERS - 1 }, () => 'DUPLICATE')].sort());
      expect(await heartbeatsOf(journeyId), `round ${String(round)}`).toHaveLength(1);
      expect(await positionsOf(journeyId), `round ${String(round)}`).toHaveLength(1);
    }
  }, 120_000);

  test(`LOST-01-AC5: ${String(RACE_ROUNDS)} times over, 20 heartbeats written at once on separate connections, started in an order unrelated to their receive times: last contact is the greatest receive time, each is stored once, and the latest is the greatest`, async () => {
    const store = databaseJourneyStore(database());

    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const { journeyId } = await walking();
      // 0, 7, 14, 1, 8, … seconds: every offset once, out of step with the
      // order the writes start in, and more writes than connections.
      const heartbeats = Array.from({ length: 20 }, (_, index) =>
        storeHeartbeat(journeyId, {
          receivedAt: new Date(HEARTBEAT_AT.getTime() + ((index * 7) % 20) * 1_000),
        }),
      );

      const results = await Promise.all(
        heartbeats.map((heartbeat) => store.recordHeartbeat(heartbeat)),
      );

      expect(results, `round ${String(round)}`).toEqual(
        heartbeats.map(() => ({ outcome: 'recorded' })),
      );
      const greatest = new Date(HEARTBEAT_AT.getTime() + 19_000);
      expect(await lastHeartbeatAt(journeyId), `round ${String(round)}`).toEqual(greatest);
      expect(new Set((await heartbeatsOf(journeyId)).map((stored) => stored.eventId)).size).toBe(
        20,
      );
      expect(await store.latestHeartbeatOf(journeyId)).toMatchObject({ receivedAt: greatest });
    }
  }, 120_000);

  test('LOST-01-AC6: phone times hours ahead of the database clock, hours behind it, and with another offset are stored as given, beside their positions only; last contact is the database’s time', async () => {
    const { device, journeyId } = await walking();
    const databaseNow = await databaseNowMs();
    const phoneTimes = [
      new Date(databaseNow + 9 * HOUR).toISOString(),
      new Date(databaseNow - 9 * HOUR).toISOString(),
      '2001-02-03T07:08:09.123+02:00',
    ];
    const sent: SyntheticHeartbeat[] = [];

    for (const recordedAt of phoneTimes) {
      const body = syntheticHeartbeat({ journeyId, position: syntheticPosition({ recordedAt }) });
      const answer = await heartbeatThroughApi(device.credential, body);
      expect(answer.status, recordedAt).toBe(200);
      sent.push(body);
    }

    expect((await positionsOf(journeyId)).map((position) => position.recordedAt)).toEqual(
      phoneTimes.map((recordedAt) => new Date(recordedAt)),
    );
    const latest = (await heartbeatsOf(journeyId)).at(-1)?.receivedAt;
    expect(await lastHeartbeatAt(journeyId)).toEqual(latest);
    expect(Math.abs((latest?.getTime() ?? 0) - (await databaseNowMs()))).toBeLessThan(HOUR);
    expect(sent).toHaveLength(3);
  });
});

describe('SM-07: an ended journey, on the real tables', () => {
  test('LOST-01-AC7: recordHeartbeat called directly with the journey ENDED in the table answers ended: no heartbeat, no position, last contact unchanged', async () => {
    // The race the module cannot see: the journey ended after it was read.
    const device = await walker();
    const journeyId = await seedJourney({
      walkerId: device.userId,
      deviceId: device.deviceId,
      state: 'ENDED',
      responderIds: [],
      startedAt: EARLIER,
      lastHeartbeatAt: EARLIER,
    });

    const result = await databaseJourneyStore(database()).recordHeartbeat(
      storeHeartbeat(journeyId),
    );

    expect(result).toEqual({ outcome: 'ended' });
    expect(await heartbeatsOf(journeyId)).toEqual([]);
    expect(await positionsOf(journeyId)).toEqual([]);
    expect(await lastHeartbeatAt(journeyId)).toEqual(EARLIER);
  });

  test('LOST-01-AC7: through the API, a heartbeat for an ENDED journey is 409 JOURNEY_ENDED, stores nothing, and logs only the journey and the reason', async () => {
    const device = await walker();
    const journeyId = await seedJourney({
      walkerId: device.userId,
      deviceId: device.deviceId,
      state: 'ENDED',
      responderIds: [],
      startedAt: EARLIER,
    });
    const log = fakeLog();

    const answer = await heartbeatThroughApi(
      device.credential,
      syntheticHeartbeat({ journeyId }),
      realApi(log),
    );

    expect(answer.status).toBe(409);
    expect((answer.body as ErrorBody).code).toBe('JOURNEY_ENDED');
    expect(await heartbeatsOf(journeyId)).toEqual([]);
    expect(log.events).toEqual([
      { event: 'heartbeat_ignored', reason: 'JOURNEY_ENDED', journeyId },
    ]);
  });
});

describe('SEC-07 and D-101: the device that started the journey, on the real tables', () => {
  test('LOST-01-AC10: a journey started through the API stores the device that sent the start in journeys.device_id, and no other', async () => {
    const phone = await walker();
    const tablet = await addDevice(phone.userId);

    const started = await start(phone.credential, { responderIds: [await addUser()] });

    expect(started.status).toBe(201);
    const { journeyId } = started.body as StartedBody;
    expect(await deviceOf(journeyId)).toBe(phone.deviceId);
    expect(await deviceOf(journeyId)).not.toBe(tablet.deviceId);
  });

  test('LOST-01-AC10: a heartbeat from the walker’s second device is 403 NOT_THE_JOURNEYS_DEVICE, stores nothing and leaves last contact; the phone’s next one is RECORDED', async () => {
    const { device: phone, journeyId } = await walking(EARLIER);
    const tablet = await addDevice(phone.userId);

    const refused = await heartbeatThroughApi(tablet.credential, syntheticHeartbeat({ journeyId }));
    const recorded = await heartbeatThroughApi(phone.credential, syntheticHeartbeat({ journeyId }));

    expect(refused.status).toBe(403);
    expect((refused.body as ErrorBody).code).toBe('NOT_THE_JOURNEYS_DEVICE');
    expect(recorded.status).toBe(200);
    expect(await heartbeatsOf(journeyId)).toHaveLength(1);
    expect(await lastHeartbeatAt(journeyId)).not.toEqual(EARLIER);
  });
});

describe('LOST-01: a heartbeat is stored whole or not at all, on the real tables', () => {
  test('LOST-01-AC13: when writing the position fails, the answer is 500, no heartbeat row is left and last contact is unchanged; with the fault gone, the same event is RECORDED, not DUPLICATE', async () => {
    const { device, journeyId } = await walking(EARLIER);
    const body = syntheticHeartbeat({ journeyId, position: syntheticPosition() });
    // A trigger this test creates and removes again, so the failure falls
    // exactly between the heartbeat row and its position: the moment a
    // missing transaction would show.
    await connection().query(
      `create function refuse_position_rows() returns trigger language plpgsql as $$
         begin
           raise exception 'position rows refused by a test trigger';
         end
       $$`,
    );
    await connection().query(
      'create trigger refuse_position_rows before insert on positions ' +
        'for each row execute function refuse_position_rows()',
    );

    try {
      const answer = await heartbeatThroughApi(device.credential, body);

      expect(answer.status).toBe(500);
      expect(answer.text).not.toContain('refused by a test trigger');
      expect(await heartbeatsOf(journeyId)).toEqual([]);
      expect(await positionsOf(journeyId)).toEqual([]);
      expect(await lastHeartbeatAt(journeyId)).toEqual(EARLIER);
    } finally {
      await connection().query('drop trigger if exists refuse_position_rows on positions');
      await connection().query('drop function if exists refuse_position_rows()');
    }

    const again = await heartbeatThroughApi(device.credential, body);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ outcome: 'RECORDED' });
    expect(await heartbeatsOf(journeyId)).toHaveLength(1);
  });
});

describe('PRIV-07: not even when the database’s own error holds the position', () => {
  test('LOST-01-AC15: controls first, then the adapter, then the API: the raw error holds the coordinates; the adapter’s HeartbeatStoreError holds a SQLSTATE and nothing of the heartbeat; the 500, the capture and the log hold none of it either', async () => {
    const { device, journeyId } = await walking(EARLIER);
    const heartbeat = storeHeartbeat(journeyId);
    const position = heartbeat.position;
    if (position === null) {
      throw new Error('this test needs a heartbeat with a position');
    }
    const markers = markersOf(heartbeat);
    // A check constraint every positions insert breaks. NOT VALID, so the
    // rows other tests left do not stop it being added.
    await connection().query(
      'alter table positions add constraint refuse_every_position ' +
        'check (latitude > 1000) not valid',
    );

    try {
      // The control: the same insert through Drizzle without the adapter
      // fails with an error whose message, or whose cause's detail, holds
      // the coordinates. Without it, a clean error below would prove nothing.
      const controlHeartbeat = await connection().query<{ id: string }>(
        'insert into heartbeats (journey_id, event_id, received_at, battery_level) ' +
          'values ($1, $2, now(), $3) returning id::text as id',
        [journeyId, syntheticEventId(), heartbeat.batteryLevel],
      );
      let raw: unknown;
      try {
        await database().execute(
          sql`insert into positions (heartbeat_id, latitude, longitude, accuracy_m, recorded_at)
              values (${controlHeartbeat.rows[0]?.id}, ${position.latitude}, ${position.longitude},
                      ${position.accuracyMeters}, ${position.recordedAt.toISOString()})`,
        );
      } catch (error) {
        raw = error;
      }
      expect(raw, 'the control insert did not fail').toBeInstanceOf(Error);
      // Drizzle puts the parameters in its own message, and PostgreSQL the
      // row in its error's detail: on the error itself, or on its cause.
      const rawError = raw as Error & { detail?: string; cause?: { detail?: string } };
      const rawText = [rawError.message, rawError.detail, rawError.cause?.detail].join('\n');
      expect(markersIn(rawText, [String(position.latitude), String(position.longitude)])).toEqual([
        String(position.latitude),
        String(position.longitude),
      ]);
      await connection().query('delete from heartbeats where id = $1', [
        controlHeartbeat.rows[0]?.id,
      ]);

      // The adapter: a HeartbeatStoreError with the SQLSTATE, no cause, no
      // other property, and nothing of the heartbeat however deep one looks.
      let rejection: unknown;
      try {
        await databaseJourneyStore(database()).recordHeartbeat(heartbeat);
      } catch (error) {
        rejection = error;
      }
      expect(rejection).toBeInstanceOf(HeartbeatStoreError);
      expect((rejection as { code?: unknown }).code).toBe('23514');
      expect((rejection as Error).cause).toBeUndefined();
      expect(
        Object.getOwnPropertyNames(rejection).filter(
          (name) => !['stack', 'message', 'code', 'name'].includes(name),
        ),
      ).toEqual([]);
      expect(markersIn(everythingIn(rejection), markers)).toEqual([]);
      expect(await heartbeatsOf(journeyId)).toEqual([]);

      // The API: a 500 holding none of it, nothing captured holding any of
      // it, and the one heartbeat_failed line carrying the SQLSTATE.
      const log = fakeLog();
      const { result: answer, written } = await captured(() =>
        heartbeatThroughApi(device.credential, bodyOf(heartbeat), realApi(log)),
      );

      expect(answer.status).toBe(500);
      expect(markersIn(`${answer.headers}\n${answer.text}`, markers)).toEqual([]);
      expect(markersIn(written, markers)).toEqual([]);
      expect(log.events).toEqual([{ event: 'heartbeat_failed', stage: 'store', code: '23514' }]);
      expect(await heartbeatsOf(journeyId)).toEqual([]);
      expect(await lastHeartbeatAt(journeyId)).toEqual(EARLIER);
    } finally {
      await connection().query(
        'alter table positions drop constraint if exists refuse_every_position',
      );
    }
  });
});

describe('the database agrees: one place for coordinates, and the rules held by constraints', () => {
  test('LOST-01-AC18: the only columns named like a coordinate, in every table, are positions.latitude and positions.longitude', async () => {
    const result = await connection().query<{ found: string }>(
      `select table_schema || '.' || table_name || '.' || column_name as found
         from information_schema.columns
        where table_schema not in ('pg_catalog', 'information_schema')
          and column_name ~* '(lat|lng|lon|coords|position|location)'
        order by 1`,
    );

    expect(result.rows.map((row) => row.found)).toEqual([
      'public.positions.latitude',
      'public.positions.longitude',
    ]);
  });

  test('LOST-01-AC18: journeys.last_heartbeat_at exists, and is null for a journey just started', async () => {
    const device = await walker();
    const started = await start(device.credential, { responderIds: [await addUser()] });
    const { journeyId } = started.body as StartedBody;

    const column = await connection().query<{ data_type: string }>(
      `select data_type from information_schema.columns
        where table_name = 'journeys' and column_name = 'last_heartbeat_at'`,
    );
    expect(column.rows.map((row) => row.data_type)).toEqual(['timestamp with time zone']);
    expect(await lastHeartbeatAt(journeyId)).toBeNull();
  });

  test('LOST-01-AC18: a second heartbeat with the same (journey_id, event_id) is refused by the database itself', async () => {
    const { journeyId } = await walking();
    const eventId = syntheticEventId();
    const insert = () =>
      connection().query(
        'insert into heartbeats (journey_id, event_id, received_at) values ($1, $2, now())',
        [journeyId, eventId],
      );
    await insert();

    await expect(insert()).rejects.toMatchObject({ code: '23505' });
  });

  test('LOST-01-AC18: a latitude, longitude, accuracy, battery level or event ID outside the contract’s rules is refused by the database itself', async () => {
    const { journeyId } = await walking();
    const heartbeatRow = (eventId: string, batteryLevel: number | string | null) =>
      connection().query<{ id: string }>(
        'insert into heartbeats (journey_id, event_id, received_at, battery_level) ' +
          'values ($1, $2, now(), $3) returning id::text as id',
        [journeyId, eventId, batteryLevel],
      );
    const { rows } = await heartbeatRow(syntheticEventId(), null);
    const heartbeatId = rows[0]?.id;
    const positionRow = (
      latitude: number | string,
      longitude: number | string,
      accuracy: number | string,
    ) =>
      connection().query(
        'insert into positions (heartbeat_id, latitude, longitude, accuracy_m, recorded_at) ' +
          'values ($1, $2, $3, $4, now())',
        [heartbeatId, latitude, longitude, accuracy],
      );
    // A data error (class 22) or a constraint (class 23): the database refused it.
    const REFUSED = { code: expect.stringMatching(/^2[23]/) as unknown };

    for (const [what, row] of [
      ['latitude above 90', () => positionRow(90.0000001, 0, 1)],
      ['latitude below -90', () => positionRow(-90.0000001, 0, 1)],
      ['latitude not a number', () => positionRow('NaN', 0, 1)],
      ['latitude infinite', () => positionRow('Infinity', 0, 1)],
      ['longitude above 180', () => positionRow(0, 180.0000001, 1)],
      ['longitude below -180', () => positionRow(0, -180.0000001, 1)],
      ['longitude not a number', () => positionRow(0, 'NaN', 1)],
      ['longitude infinite', () => positionRow(0, '-Infinity', 1)],
      ['accuracy below 0', () => positionRow(0, 0, -0.125)],
      ['accuracy not a number', () => positionRow(0, 0, 'NaN')],
      ['accuracy infinite', () => positionRow(0, 0, 'Infinity')],
      ['battery above 1', () => heartbeatRow(syntheticEventId(), 1.015625)],
      ['battery below 0', () => heartbeatRow(syntheticEventId(), -0.015625)],
      ['battery not a number', () => heartbeatRow(syntheticEventId(), 'NaN')],
      ['an empty event ID', () => heartbeatRow('', null)],
      ['an event ID of 65 characters', () => heartbeatRow('e'.repeat(65), null)],
      ['an event ID with an underscore', () => heartbeatRow('synthetic_event', null)],
      ['an event ID with a dot', () => heartbeatRow('synthetic.event', null)],
      ['an event ID with a space', () => heartbeatRow('synthetic event', null)],
      ['an event ID with a letter outside ASCII', () => heartbeatRow('synthetic-ø', null)],
    ] as const) {
      await expect(row(), what).rejects.toMatchObject(REFUSED);
    }

    // And the boundaries are accepted, so the refusals above are the rule's.
    for (const [what, row] of [
      ['latitude 90, longitude 180, accuracy 0', () => positionRow(90, 180, 0)],
      ['battery 0', () => heartbeatRow(syntheticEventId(), 0)],
      ['battery 1', () => heartbeatRow(syntheticEventId(), 1)],
      ['an event ID of 64 characters', () => heartbeatRow('e'.repeat(64), null)],
    ] as const) {
      await expect(row(), what).resolves.toBeDefined();
    }
  });

  test('LOST-01-AC18: journeys.device_id is not null and references devices (D-101)', async () => {
    const column = await connection().query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
        where table_name = 'journeys' and column_name = 'device_id'`,
    );
    const references = await connection().query<{ target: string }>(
      `select confrelid::regclass::text as target
         from pg_constraint
        where conrelid = 'journeys'::regclass and contype = 'f'
          and conkey = array[(select attnum from pg_attribute
                               where attrelid = 'journeys'::regclass and attname = 'device_id')]`,
    );

    expect(column.rows).toEqual([{ is_nullable: 'NO' }]);
    expect(references.rows).toEqual([{ target: 'devices' }]);
  });
});

// ===========================================================================
// LOST-02: the row lock a heartbeat takes, proved by the lock's effect; and
// the two tables an alert writes, as the database holds them.
// ===========================================================================

/** This URI with a query parameter added: here, a name its sessions show in pg_stat_activity. */
function withParameter(uri: string, name: string, value: string): string {
  const url = new URL(uri);
  url.searchParams.set(name, value);
  return url.toString();
}

/** How many sessions of this application are waiting on a lock right now. */
async function waitingOnALock(applicationName: string): Promise<number> {
  const result = await connection().query<{ n: number }>(
    `select count(*)::int as n from pg_stat_activity
      where application_name = $1 and wait_event_type = 'Lock'`,
    [applicationName],
  );
  return result.rows[0]?.n ?? 0;
}

/** Waits, in short sleeps rather than by a clock, until `check` holds or the attempts run out. */
async function eventually(check: () => Promise<boolean>, attempts = 200): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return check();
}

describe('SM-07 and LOST-02: a heartbeat waits for an uncommitted ENDED, on the real tables', () => {
  test.each(['commit', 'rollback'] as const)(
    'LOST-02-AC11: with another transaction ending J and not yet committed, recordHeartbeat for J waits on J’s row lock; once that transaction ends with %s, it answers ended and stores nothing, or, rolled back, is recorded',
    async (ending) => {
      const { journeyId } = await walking(EARLIER);
      const applicationName = `lost02_ac11_${ending}`;
      const heartbeatPool = createPool(
        withParameter(connectionUri(), 'application_name', applicationName),
        1,
      );
      const ender = await connection().connect();
      try {
        await ender.query('begin');
        await ender.query("update journeys set state = 'ENDED' where id = $1", [journeyId]);
        const heartbeat = storeHeartbeat(journeyId);
        let answer: unknown;
        const recording = databaseJourneyStore(createDatabase(heartbeatPool))
          .recordHeartbeat(heartbeat)
          .then((result) => {
            answer = result;
          });

        // Waiting on J's row lock, as pg_stat_activity shows it: not merely slow.
        expect(await eventually(async () => (await waitingOnALock(applicationName)) === 1)).toBe(
          true,
        );
        expect(answer).toBeUndefined();

        await ender.query(ending);
        await recording;

        if (ending === 'commit') {
          expect(answer).toEqual({ outcome: 'ended' });
          expect(await heartbeatsOf(journeyId)).toEqual([]);
          expect(await positionsOf(journeyId)).toEqual([]);
          expect(await lastHeartbeatAt(journeyId)).toEqual(EARLIER);
        } else {
          expect(answer).toEqual({ outcome: 'recorded' });
          expect(await heartbeatsOf(journeyId)).toHaveLength(1);
          expect(await lastHeartbeatAt(journeyId)).toEqual(heartbeat.receivedAt);
        }
      } finally {
        ender.release();
        await endTestPool(heartbeatPool);
      }
    },
  );
});

/** An alert put in directly for this journey, in this state; resolves to its ID. */
async function insertAlert(journeyId: string, state: string): Promise<string> {
  const id = syntheticUuid();
  await connection().query(
    `insert into alerts (id, journey_id, state, opened_at, silent_since)
     values ($1, $2, $3, now(), now())`,
    [id, journeyId, state],
  );
  return id;
}

/** An outbox message put in directly; every column given, so no default is relied on. */
function insertMessage({
  alertId,
  recipientId,
  kind = 'LOST_CONTACT',
  attempts = 0,
  lastFailure = null,
}: {
  alertId: string;
  recipientId: string;
  kind?: string;
  attempts?: number;
  lastFailure?: string | null;
}) {
  return connection().query(
    `insert into outbox (id, alert_id, recipient_id, kind, created_at, attempts,
                         next_attempt_at, sent_at, last_failure)
     values ($1, $2, $3, $4, now(), $5, now(), null, $6)`,
    [syntheticUuid(), alertId, recipientId, kind, attempts, lastFailure],
  );
}

/** A data error (class 22) or a constraint (class 23): the database refused it itself. */
const REFUSED_BY_THE_DATABASE = { code: expect.stringMatching(/^2[23]/) as unknown };

// ---------------------------------------------------------------------------
// LOST-02, review loop 2: the waits of an open after it took its row, and a
// claim that never waits (test-auditor's re-audit).
// ---------------------------------------------------------------------------

/** Settles as `promise` does, or as `still waiting` once `ms` have passed: a wait with no end fails here, not by hanging. */
async function bounded<T>(promise: Promise<T>, ms: number): Promise<T | 'still waiting'> {
  promise.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'still waiting'>((resolve) => {
    timer = setTimeout(() => {
      resolve('still waiting');
    }, ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** A psql-like session of the test's own: its own connection, outside every pool, holding one row `for update`. */
async function sessionHolding(table: 'journeys' | 'users' | 'outbox', id: string) {
  const session = new pg.Client({ connectionString: connectionUri() });
  await session.connect();
  await session.query('begin');
  await session.query(`select id from ${table} where id = $1 for update`, [id]);
  const pid = (await session.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid;
  return {
    /** Whether another session is waiting for a lock this one holds. */
    waitedFor: async () => {
      const waiting = await connection().query<{ n: number }>(
        'select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
        [pid],
      );
      return (waiting.rows[0]?.n ?? 0) > 0;
    },
    commit: () => session.query('commit'),
    end: async () => {
      await session.query('rollback').catch(() => undefined);
      await session.end();
    },
  };
}

/** An overdue ACTIVE journey of a new walker, silent since EARLIER, with these many new responders. */
async function overdueWith(responders: number) {
  const device = await walker();
  const responderIds: string[] = [];
  for (let i = 0; i < responders; i += 1) {
    responderIds.push(await addUser());
  }
  const journeyId = await seedJourney({
    walkerId: device.userId,
    deviceId: device.deviceId,
    state: 'ACTIVE',
    responderIds,
    startedAt: EARLIER,
    lastHeartbeatAt: null,
  });
  return { journeyId, responderIds };
}

describe('LOST-02: what an open waits for after it took its row, and what a claim never waits for', () => {
  test('LOST-02-AC20: a waiting open that takes the journey’s row within the wait, then runs out of time on a responder’s users row, fails with 55P03 and writes nothing; it never answers held', async () => {
    const { journeyId, responderIds } = await overdueWith(1);
    const rowHolder = await sessionHolding('journeys', journeyId);
    const userHolder = await sessionHolding('users', responderIds[0] ?? '');
    const lockWaitMs = 1_000;
    let outcome: unknown;
    try {
      const opening = databaseJourneyStore(database())
        .openLostContactAlert({ journeyId, afterMs: LOST_CONTACT_AFTER_MS, lockWaitMs })
        .then(
          (answer) => ({ answer }),
          (error: unknown) => ({ error }),
        );
      // The open waits for the journey's row; its holder lets go within the
      // wait, and the open takes it, then waits for the users row its
      // message references, which is held for good.
      expect(await eventually(() => rowHolder.waitedFor())).toBe(true);
      await rowHolder.commit();
      outcome = await bounded(opening, 3 * lockWaitMs + 2_000);
    } finally {
      await rowHolder.end();
      await userHolder.end();
    }

    expect(outcome).not.toEqual({ answer: { outcome: 'held' } });
    const failed = outcome as { error?: unknown };
    expect(failed.error, JSON.stringify(outcome)).toBeInstanceOf(Error);
    expect(sqlstateOf(failed.error)).toBe('55P03');
    expect(await stateOf(journeyId)).toBe('ACTIVE');
    expect(await alertsOf(journeyId)).toEqual([]);
    expect(await messagesOf(journeyId)).toEqual([]);
  }, 30_000);

  test('LOST-02-AC14: a due message whose row another session holds is passed over at once, not waited for, and the claim returns the other due messages', async () => {
    const store = databaseJourneyStore(database());
    const { journeyId } = await overdueWith(3);
    const opened = await store.openLostContactAlert({ journeyId, afterMs: LOST_CONTACT_AFTER_MS });
    if (opened.outcome !== 'opened') {
      throw new Error(`expected the journey to be opened, but it was ${opened.outcome}`);
    }
    // Only this alert's messages are due: every other test's are put out of reach.
    await connection().query(
      'update outbox set sent_at = now() where sent_at is null and alert_id <> $1',
      [opened.alertId],
    );
    const [held, ...others] = opened.messages;
    if (held === undefined) {
      throw new Error('expected three messages');
    }
    const holder = await sessionHolding('outbox', held.messageId);
    let claim: Awaited<ReturnType<typeof store.claimDue>> | 'still waiting';
    let tookMs: number;
    try {
      const started = performance.now();
      // The worker's pool keeps no lock limit, so a claim that waited would
      // wait for ever: bounded, it fails here instead.
      claim = await bounded(store.claimDue({ limit: 50, leaseMs: 30_000 }), 2_000);
      tookMs = performance.now() - started;
    } finally {
      await holder.end();
    }

    expect(claim).not.toBe('still waiting');
    const claimed =
      claim === 'still waiting' ? [] : claim.messages.map(({ messageId }) => messageId);
    expect([...claimed].sort()).toEqual(others.map(({ messageId }) => messageId).sort());
    expect(claimed).not.toContain(held.messageId);
    expect(tookMs).toBeLessThan(2_000);
  }, 30_000);
});

describe('LOST-02: the database agrees on alerts and their messages', () => {
  test('LOST-02-AC23: alert_state’s values are exactly ALERT_STATES, in order, and alerts.state is of that type', async () => {
    const labels = await connection().query<{ label: string }>(
      `select e.enumlabel as label from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'alert_state' order by e.enumsortorder`,
    );
    const column = await connection().query<{ udt_name: string }>(
      `select udt_name from information_schema.columns
        where table_name = 'alerts' and column_name = 'state'`,
    );

    expect(labels.rows.map(({ label }) => label)).toEqual([...ALERT_STATES]);
    expect(column.rows).toEqual([{ udt_name: 'alert_state' }]);
  });

  test('LOST-02-AC23: a second alert for a journey whose alert is not RESOLVED is refused by the database itself, whatever its state; the index’s predicate reads <> RESOLVED; RESOLVED alerts block nothing', async () => {
    const { journeyId } = await walking();
    await insertAlert(journeyId, 'OPEN');

    // Every state the index covers: all but RESOLVED, which frees the journey.
    for (const state of ALERT_STATES.filter((each) => each !== 'RESOLVED')) {
      await expect(insertAlert(journeyId, state), state).rejects.toMatchObject({ code: '23505' });
    }

    const indexes = await connection().query<{ definition: string }>(
      `select pg_get_indexdef(indexrelid) as definition from pg_index
        where indrelid = 'alerts'::regclass and indisunique and indpred is not null`,
    );
    expect(indexes.rows).toHaveLength(1);
    expect(indexes.rows[0]?.definition).toMatch(/\(journey_id\)/);
    expect(indexes.rows[0]?.definition).toMatch(/WHERE \(state <> 'RESOLVED'::alert_state\)/);

    const other = await walking();
    await insertAlert(other.journeyId, 'RESOLVED');
    await insertAlert(other.journeyId, 'RESOLVED');
    await expect(insertAlert(other.journeyId, 'OPEN')).resolves.toBeDefined();
  });

  // RG-03 (LOST-03, the spec's "Existing assertions that change by design"):
  // this was "…created by migration 0003 itself, and no migration 0004
  // exists". 0004 now exists, for LOST-03's own columns. The test's point,
  // that the index is created by 0003 and by no separate migration, is kept:
  // no later migration names it, so none creates it again or drops it.
  test('LOST-02-AC23: outbox has a partial index on (next_attempt_at, id) where sent_at is null, created by migration 0003 itself, and no later migration creates or drops it', async () => {
    // The claim's own order, over the unsent rows only (approach item 4,
    // review loop 1): sent rows stay until retention removes them.
    const indexes = await connection().query<{ definition: string }>(
      `select pg_get_indexdef(indexrelid) as definition from pg_index
        where indrelid = 'outbox'::regclass and indpred is not null`,
    );
    expect(
      indexes.rows.filter(
        ({ definition }) =>
          definition.includes('(next_attempt_at, id)') &&
          definition.includes('WHERE (sent_at IS NULL)'),
      ),
      JSON.stringify(indexes.rows),
    ).toHaveLength(1);

    const folder = path.join(import.meta.dirname, '..', 'db', 'migrations');
    const files = readdirSync(folder);
    const later = files.filter((file) => /^\d{4}_.*\.sql$/.test(file) && file > '0004');
    for (const file of later) {
      expect(readFileSync(path.join(folder, file), 'utf8'), file).not.toMatch(
        /outbox_unsent_due_index/i,
      );
    }
    const migration0003 = files.filter((file) => /^0003_.*\.sql$/.test(file));
    expect(migration0003).toHaveLength(1);
    const text = readFileSync(path.join(folder, migration0003[0] ?? ''), 'utf8');
    expect(text).toMatch(
      /create index\s+"?\w+"?\s+on\s+"?outbox"?[^;]*\(\s*"?next_attempt_at"?[^,()]*,\s*"?id"?[^()]*\)[^;]*where[^;]*"?sent_at"?\s+is\s+null/i,
    );
  });

  test('LOST-02-AC23: a second outbox message for the same alert, recipient and kind is refused by the database itself', async () => {
    const { journeyId } = await walking();
    const alertId = await insertAlert(journeyId, 'OPEN');
    const recipientId = await addUser();
    await insertMessage({ alertId, recipientId });

    await expect(insertMessage({ alertId, recipientId })).rejects.toMatchObject({ code: '23505' });
    await expect(insertMessage({ alertId, recipientId: await addUser() })).resolves.toBeDefined();
  });

  test('LOST-02-AC23: an outbox message naming no alert, or no user, is refused', async () => {
    const { journeyId } = await walking();
    const alertId = await insertAlert(journeyId, 'OPEN');

    await expect(
      insertMessage({ alertId: syntheticUuid(), recipientId: await addUser() }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(insertMessage({ alertId, recipientId: syntheticUuid() })).rejects.toMatchObject({
      code: '23503',
    });
  });

  test('LOST-02-AC23: a negative number of attempts, a failure reason outside the push port’s four, and a kind other than LOST_CONTACT are refused by the database itself; the four reasons are accepted', async () => {
    const { journeyId } = await walking();
    const alertId = await insertAlert(journeyId, 'OPEN');

    await expect(
      insertMessage({ alertId, recipientId: await addUser(), attempts: -1 }),
    ).rejects.toMatchObject(REFUSED_BY_THE_DATABASE);
    for (const lastFailure of ['TIMEOUT', 'no_target', '']) {
      await expect(
        insertMessage({ alertId, recipientId: await addUser(), lastFailure }),
        lastFailure,
      ).rejects.toMatchObject(REFUSED_BY_THE_DATABASE);
    }
    await expect(
      insertMessage({ alertId, recipientId: await addUser(), kind: 'LOW_BATTERY' }),
    ).rejects.toMatchObject(REFUSED_BY_THE_DATABASE);
    for (const lastFailure of ['NO_TARGET', 'REFUSED', 'UNAVAILABLE', 'NOT_CONFIGURED']) {
      await expect(
        insertMessage({ alertId, recipientId: await addUser(), lastFailure }),
        lastFailure,
      ).resolves.toBeDefined();
    }
  });

  test('LOST-02-AC23: with alerts and outbox in place, the only columns named like a coordinate, in every table, are still positions.latitude and positions.longitude', async () => {
    const tables = await connection().query<{ alerts: string | null; outbox: string | null }>(
      "select to_regclass('alerts')::text as alerts, to_regclass('outbox')::text as outbox",
    );
    const result = await connection().query<{ found: string }>(
      `select table_schema || '.' || table_name || '.' || column_name as found
         from information_schema.columns
        where table_schema not in ('pg_catalog', 'information_schema')
          and column_name ~* '(lat|lng|lon|coords|position|location)'
        order by 1`,
    );

    expect(tables.rows).toEqual([{ alerts: 'alerts', outbox: 'outbox' }]);
    expect(result.rows.map((row) => row.found)).toEqual([
      'public.positions.latitude',
      'public.positions.longitude',
    ]);
  });

  test('LOST-02-AC13: alerts and outbox hold exactly the spec’s columns, and none holds a coordinate, an accuracy, a phone time, a battery level, a name or a phone number', async () => {
    const columnsOf = async (table: string) =>
      (
        await connection().query<{ column_name: string }>(
          `select column_name from information_schema.columns
            where table_schema = 'public' and table_name = $1 order by column_name`,
          [table],
        )
      ).rows.map(({ column_name }) => column_name);

    const alerts = await columnsOf('alerts');
    const outbox = await columnsOf('outbox');

    // RG-03 (LOST-03, the spec's "Existing assertions that change by
    // design"): the exact lists gain alerts.resolved_at and
    // alerts.resolution, and outbox.withdrawn_at (LOST-03's approach item 6).
    // Still exact; the scan below covers the new columns as it stands.
    //
    // RG-03 (LOST-06, the spec's "Existing assertions that change by
    // design"): the alerts list gains acknowledged_by and acknowledged_at
    // (LOST-06's approach item 7). Still exact; the scan below covers both as
    // it stands, and neither name matches it.
    //
    // RG-03 (LOST-07, the spec's "Existing assertions that change by
    // design"): the alerts list gains sms_raised_at (LOST-07's approach item
    // 9). Still exact; the scan below covers it as it stands, and the name
    // matches none of it.
    //
    // RG-03 (SM-10, named in the spec's "Existing assertions that change by
    // design"): alerts gains round, and outbox gains journey_id and round
    // (SM-10's approach item 9). Still exact; the scan below covers all three
    // as it stands, and none matches it.
    expect(alerts).toEqual(
      [
        'id',
        'journey_id',
        'opened_at',
        'silent_since',
        'state',
        'resolved_at',
        'resolution',
        'acknowledged_by',
        'acknowledged_at',
        'sms_raised_at',
        'round',
      ].sort(),
    );
    expect(outbox).toEqual(
      [
        'id',
        'alert_id',
        'recipient_id',
        'kind',
        'created_at',
        'attempts',
        'next_attempt_at',
        'sent_at',
        'last_failure',
        'withdrawn_at',
        'journey_id',
        'round',
      ].sort(),
    );
    expect(
      [...alerts, ...outbox].filter((column) =>
        /lat|lng|lon|coord|position|location|accuracy|recorded|battery|phone|name/i.test(column),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LOST-03-AC20: the database agrees with the domain's lists, and holds the
// rule that a resolution and an end each come with their time (SM-04).
// ---------------------------------------------------------------------------

/** An enum's labels, in the database's order (pg_enum). */
async function labelsOf(typeName: string): Promise<string[]> {
  const labels = await connection().query<{ label: string }>(
    `select e.enumlabel as label from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = $1 order by e.enumsortorder`,
    [typeName],
  );
  return labels.rows.map(({ label }) => label);
}

/** A column's type as information_schema names it, with its type's own name. */
async function typeOf(
  table: string,
  column: string,
): Promise<{ data_type: string; udt_name: string; is_nullable: string } | undefined> {
  const result = await connection().query<{
    data_type: string;
    udt_name: string;
    is_nullable: string;
  }>(
    `select data_type, udt_name, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [table, column],
  );
  return result.rows[0];
}

/** A RESOLVED alert put in directly with these two columns, so the unresolved index never interferes. */
async function insertResolvedAlert(
  journeyId: string,
  { resolvedAt, resolution }: { resolvedAt: boolean; resolution: string | null },
): Promise<string> {
  const id = syntheticUuid();
  await connection().query(
    `insert into alerts (id, journey_id, state, opened_at, silent_since, resolved_at, resolution)
     values ($1, $2, 'RESOLVED', now(), now(), case when $3::boolean then now() end, $4)`,
    [id, journeyId, resolvedAt, resolution],
  );
  return id;
}

/** Sets a journey's end time and end reason directly, as given. */
function setJourneyEnd(
  journeyId: string,
  { endedAt, endReason }: { endedAt: boolean; endReason: string | null },
) {
  return connection().query(
    `update journeys set ended_at = case when $2::boolean then now() end, end_reason = $3
      where id = $1`,
    [journeyId, endedAt, endReason],
  );
}

describe('LOST-03 and SM-04: the database agrees on resolutions, ends and the new message kinds', () => {
  test('LOST-03-AC20: message_kind’s values are exactly MESSAGE_KINDS, alert_resolution’s exactly ALERT_RESOLUTIONS, and journey_end_reason’s exactly JOURNEY_END_REASONS, each in order (pg_enum); outbox.kind, alerts.resolution and journeys.end_reason are of those types', async () => {
    const messageKinds = await labelsOf('message_kind');
    const alertResolutions = await labelsOf('alert_resolution');
    const journeyEndReasons = await labelsOf('journey_end_reason');

    // The spec's own lists first, so a domain list that drifted with the
    // database cannot carry both along (approach item 1).
    // RG-03 (LOST-06, the spec's "Existing assertions that change by
    // design"): the literal message_kind list gains ACKNOWLEDGED, the notice
    // (D-113), last, as migration 0005 adds it. The assertion against the
    // domain's MESSAGE_KINDS below is unchanged.
    // RG-03 (LOST-07, the spec's "Existing assertions that change by
    // design"): and gains LOST_CONTACT_SMS, the escalation's SMS (D-019),
    // last, as migration 0006 adds it. The assertion against the domain's
    // MESSAGE_KINDS below is unchanged.
    // RG-03 (SM-10, named in the spec's "Existing assertions that change by
    // design"): and gains NO_RESPONDER, the walker's warning (SM-02), last,
    // as migration 0007 adds it. The assertion against the domain's
    // MESSAGE_KINDS below is unchanged.
    // RG-03 (LOST-08, named in the spec's "Existing assertions that change by
    // design"): the three literal lists gain SAFE and EXPIRED, the close's
    // and the 24-hour end's (D-126), last, as migration 0008 adds them: as a
    // message kind (each its resolution's stand-down, D-112), as a
    // resolution, and as an end reason. The assertions against the domain's
    // lists below are unchanged.
    expect(messageKinds).toEqual([
      'LOST_CONTACT',
      'BACK_IN_CONTACT',
      'HOME',
      'ACKNOWLEDGED',
      'LOST_CONTACT_SMS',
      'NO_RESPONDER',
      'SAFE',
      'EXPIRED',
    ]);
    expect(alertResolutions).toEqual(['BACK_IN_CONTACT', 'HOME', 'SAFE', 'EXPIRED']);
    expect(journeyEndReasons).toEqual(['HOME', 'SAFE', 'EXPIRED']);
    expect(messageKinds).toEqual(MESSAGE_KINDS);
    expect(alertResolutions).toEqual(ALERT_RESOLUTIONS);
    expect(journeyEndReasons).toEqual(JOURNEY_END_REASONS);

    expect(await typeOf('outbox', 'kind')).toMatchObject({ udt_name: 'message_kind' });
    expect(await typeOf('alerts', 'resolution')).toEqual({
      data_type: 'USER-DEFINED',
      udt_name: 'alert_resolution',
      is_nullable: 'YES',
    });
    expect(await typeOf('journeys', 'end_reason')).toEqual({
      data_type: 'USER-DEFINED',
      udt_name: 'journey_end_reason',
      is_nullable: 'YES',
    });
  });

  test('LOST-03-AC20: alerts.resolved_at, journeys.ended_at and outbox.withdrawn_at are database times (timestamp with time zone), null until set', async () => {
    for (const [table, column] of [
      ['alerts', 'resolved_at'],
      ['journeys', 'ended_at'],
      ['outbox', 'withdrawn_at'],
    ] as const) {
      expect(await typeOf(table, column), `${table}.${column}`).toEqual({
        data_type: 'timestamp with time zone',
        udt_name: 'timestamptz',
        is_nullable: 'YES',
      });
    }
  });

  test('LOST-03-AC20: the database itself refuses an alert with resolved_at and no resolution, or a resolution and no resolved_at; both, or neither, are taken', async () => {
    const { journeyId } = await walking();

    await expect(
      insertResolvedAlert(journeyId, { resolvedAt: true, resolution: null }),
    ).rejects.toMatchObject({ code: '23514' });
    for (const resolution of ['BACK_IN_CONTACT', 'HOME']) {
      await expect(
        insertResolvedAlert(journeyId, { resolvedAt: false, resolution }),
        resolution,
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        insertResolvedAlert(journeyId, { resolvedAt: true, resolution }),
        resolution,
      ).resolves.toBeDefined();
    }
    await expect(
      insertResolvedAlert(journeyId, { resolvedAt: false, resolution: null }),
    ).resolves.toBeDefined();

    // And on an update of a row already there, not only on an insert.
    const alertId = await insertResolvedAlert(journeyId, { resolvedAt: true, resolution: 'HOME' });
    await expect(
      connection().query('update alerts set resolution = null where id = $1', [alertId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      connection().query('update alerts set resolved_at = null where id = $1', [alertId]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('LOST-03-AC20: the database itself refuses a journey with ended_at and no end_reason, or an end_reason and no ended_at; both, or neither, are taken', async () => {
    const { journeyId } = await walking();

    await expect(
      setJourneyEnd(journeyId, { endedAt: true, endReason: null }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      setJourneyEnd(journeyId, { endedAt: false, endReason: 'HOME' }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      setJourneyEnd(journeyId, { endedAt: true, endReason: 'HOME' }),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      setJourneyEnd(journeyId, { endedAt: false, endReason: null }),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  test('LOST-03-AC20: a resolution or an end reason outside the lists is refused by the database itself', async () => {
    const { journeyId } = await walking();

    await expect(
      insertResolvedAlert(journeyId, { resolvedAt: true, resolution: 'LOST_CONTACT' }),
    ).rejects.toMatchObject(REFUSED_BY_THE_DATABASE);
    await expect(
      setJourneyEnd(journeyId, { endedAt: true, endReason: 'BACK_IN_CONTACT' }),
    ).rejects.toMatchObject(REFUSED_BY_THE_DATABASE);
  });

  test('LOST-03-AC20: the claim’s partial index still reads (next_attempt_at, id) with the predicate sent_at IS NULL (pg_get_indexdef)', async () => {
    // Unchanged by design (approach item 6): withdrawn rows stay in it,
    // unsent, until the retention work removes them.
    const index = await connection().query<{ definition: string }>(
      `select pg_get_indexdef(indexrelid) as definition from pg_index
        where indexrelid = to_regclass('outbox_unsent_due_index')`,
    );

    expect(index.rows.map(({ definition }) => definition)).toEqual([
      'CREATE INDEX outbox_unsent_due_index ON public.outbox USING btree (next_attempt_at, id) WHERE (sent_at IS NULL)',
    ]);
  });
});

// ---------------------------------------------------------------------------
// LOST-06-AC10 and AC17: the database agrees with "I'm on it" (migration
// 0005, its spec's approach item 7): the notice's kind, and who is on an
// alert and since when, both or neither, the acknowledger a user.
// ---------------------------------------------------------------------------

/**
 * An alert put in directly with the acknowledgement's two columns as given:
 * RESOLVED, with its resolution, so the one-unresolved index never
 * interferes, unless a state is given.
 */
async function insertAcknowledgedAlert(
  journeyId: string,
  {
    acknowledgedBy,
    acknowledgedAt,
    state = 'RESOLVED',
  }: { acknowledgedBy: string | null; acknowledgedAt: boolean; state?: string },
): Promise<string> {
  const id = syntheticUuid();
  await connection().query(
    `insert into alerts (id, journey_id, state, opened_at, silent_since, resolved_at, resolution,
                         acknowledged_by, acknowledged_at)
     values ($1, $2, $3::alert_state, now(), now(),
             case when $3 = 'RESOLVED' then now() end,
             case when $3 = 'RESOLVED' then 'HOME'::alert_resolution end,
             $4, case when $5::boolean then now() end)`,
    [id, journeyId, state, acknowledgedBy, acknowledgedAt],
  );
  return id;
}

describe('LOST-06: the database agrees on who is on an alert, and on the notice', () => {
  test('LOST-06-AC10: no column of alerts or outbox holds a coordinate, an accuracy, a phone time, a battery level, a name or a phone number; alerts.acknowledged_by is a UUID referencing users; and the only columns named like a coordinate, in every table, are still positions.latitude and positions.longitude (information_schema)', async () => {
    const columnsOf = async (table: string) =>
      (
        await connection().query<{ column_name: string }>(
          `select column_name from information_schema.columns
            where table_schema = 'public' and table_name = $1 order by column_name`,
          [table],
        )
      ).rows.map(({ column_name }) => column_name);
    const alerts = await columnsOf('alerts');
    const outbox = await columnsOf('outbox');
    const coordinates = await connection().query<{ found: string }>(
      `select table_schema || '.' || table_name || '.' || column_name as found
         from information_schema.columns
        where table_schema not in ('pg_catalog', 'information_schema')
          and column_name ~* '(lat|lng|lon|coords|position|location)'
        order by 1`,
    );
    const references = await connection().query<{ referenced: string; column_name: string }>(
      `select c.confrelid::regclass::text as referenced, a.attname as column_name
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
        where c.conrelid = 'alerts'::regclass and c.contype = 'f'
        order by a.attname`,
    );

    expect(alerts).toEqual(expect.arrayContaining(['acknowledged_by', 'acknowledged_at']));
    expect(
      [...alerts, ...outbox].filter((column) =>
        /lat|lng|lon|coord|position|location|accuracy|recorded|battery|phone|name/i.test(column),
      ),
    ).toEqual([]);
    expect(await typeOf('alerts', 'acknowledged_by')).toEqual({
      data_type: 'uuid',
      udt_name: 'uuid',
      is_nullable: 'YES',
    });
    expect(references.rows).toContainEqual({ referenced: 'users', column_name: 'acknowledged_by' });
    expect(coordinates.rows.map(({ found }) => found)).toEqual([
      'public.positions.latitude',
      'public.positions.longitude',
    ]);
  });

  // RG-03 (LOST-07, the spec's "Existing assertions that change by design"):
  // this was "…in order, ACKNOWLEDGED last (pg_enum)…". Migration 0006 adds
  // LOST_CONTACT_SMS after it, so the literal list gains it and the title no
  // longer says ACKNOWLEDGED is last. The assertion against the domain's
  // MESSAGE_KINDS is unchanged.
  //
  // RG-03 (SM-10, named in the spec's "Existing assertions that change by
  // design"): migration 0007 adds NO_RESPONDER last, so the literal list
  // gains it. The assertion against the domain's MESSAGE_KINDS is unchanged.
  test('LOST-06-AC17: message_kind’s values equal MESSAGE_KINDS, in order (pg_enum); outbox.kind is of that type', async () => {
    const messageKinds = await labelsOf('message_kind');

    // The spec's own list first, so a domain list that drifted with the
    // database cannot carry both along.
    // RG-03 (LOST-08, named in the spec's "Existing assertions that change by
    // design"): migration 0008 adds SAFE and EXPIRED after NO_RESPONDER, so
    // the literal list gains them. The assertion against the domain's
    // MESSAGE_KINDS is unchanged.
    expect(messageKinds).toEqual([
      'LOST_CONTACT',
      'BACK_IN_CONTACT',
      'HOME',
      'ACKNOWLEDGED',
      'LOST_CONTACT_SMS',
      'NO_RESPONDER',
      'SAFE',
      'EXPIRED',
    ]);
    expect(messageKinds).toEqual([...MESSAGE_KINDS]);
    expect(await typeOf('outbox', 'kind')).toMatchObject({ udt_name: 'message_kind' });
  });

  test('LOST-06-AC17: alerts.acknowledged_by is a UUID referencing users, and alerts.acknowledged_at a database time (timestamp with time zone), both null until set', async () => {
    const { journeyId } = await walking();
    const alertId = await insertAlert(journeyId, 'OPEN');

    expect(await typeOf('alerts', 'acknowledged_by')).toMatchObject({ udt_name: 'uuid' });
    expect(await typeOf('alerts', 'acknowledged_at')).toEqual({
      data_type: 'timestamp with time zone',
      udt_name: 'timestamptz',
      is_nullable: 'YES',
    });
    const fresh = await connection().query<{ by: string | null; at: string | null }>(
      'select acknowledged_by::text as by, acknowledged_at::text as at from alerts where id = $1',
      [alertId],
    );
    expect(fresh.rows).toEqual([{ by: null, at: null }]);
    // The reference holds: an acknowledger who is no user is refused.
    await expect(
      insertAcknowledgedAlert(journeyId, { acknowledgedBy: syntheticUuid(), acknowledgedAt: true }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  test('LOST-06-AC17: the database itself refuses an alert with acknowledged_by and no acknowledged_at, or the reverse; it takes both, or neither; and it takes an ACKNOWLEDGED alert with neither, as no check ties the state to them', async () => {
    const { journeyId } = await walking();
    const responderId = await addUser();

    await expect(
      insertAcknowledgedAlert(journeyId, { acknowledgedBy: responderId, acknowledgedAt: false }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertAcknowledgedAlert(journeyId, { acknowledgedBy: null, acknowledgedAt: true }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertAcknowledgedAlert(journeyId, { acknowledgedBy: responderId, acknowledgedAt: true }),
    ).resolves.toBeDefined();
    await expect(
      insertAcknowledgedAlert(journeyId, { acknowledgedBy: null, acknowledgedAt: false }),
    ).resolves.toBeDefined();
    await expect(
      insertAcknowledgedAlert((await walking()).journeyId, {
        acknowledgedBy: null,
        acknowledgedAt: false,
        state: 'ACKNOWLEDGED',
      }),
    ).resolves.toBeDefined();

    // And on an update of a row already there, not only on an insert.
    const alertId = await insertAcknowledgedAlert(journeyId, {
      acknowledgedBy: responderId,
      acknowledgedAt: true,
    });
    await expect(
      connection().query('update alerts set acknowledged_by = null where id = $1', [alertId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      connection().query('update alerts set acknowledged_at = null where id = $1', [alertId]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('LOST-06-AC17: the claim’s partial index still reads (next_attempt_at, id) with the predicate sent_at IS NULL (pg_get_indexdef)', async () => {
    const index = await connection().query<{ definition: string }>(
      `select pg_get_indexdef(indexrelid) as definition from pg_index
        where indexrelid = to_regclass('outbox_unsent_due_index')`,
    );

    expect(index.rows.map(({ definition }) => definition)).toEqual([
      'CREATE INDEX outbox_unsent_due_index ON public.outbox USING btree (next_attempt_at, id) WHERE (sent_at IS NULL)',
    ]);
  });
});

// ---------------------------------------------------------------------------
// LOST-07-AC4, AC8 and AC19: the database agrees with the escalation
// (migration 0006, its spec's approach item 9): the SMS's kind, when an alert
// was escalated, no check tying that time to the state, one SMS per alert
// and recipient, and still no column that could hold a location or a number.
// ---------------------------------------------------------------------------

describe('LOST-07: the database agrees on the escalation and its SMS', () => {
  // RG-03 (SM-10, named in the spec's "Existing assertions that change by
  // design"): this was "…in order, LOST_CONTACT_SMS last (pg_enum)…".
  // Migration 0007 adds NO_RESPONDER after it, so the literal list gains it
  // and the title no longer says LOST_CONTACT_SMS is last. The assertion
  // against the domain's MESSAGE_KINDS is unchanged.
  test('LOST-07-AC19: message_kind’s values equal MESSAGE_KINDS, in order (pg_enum); outbox.kind is of that type', async () => {
    const messageKinds = await labelsOf('message_kind');

    // The spec's own list first, so a domain list that drifted with the
    // database cannot carry both along.
    // RG-03 (LOST-08, named in the spec's "Existing assertions that change by
    // design"): migration 0008 adds SAFE and EXPIRED after NO_RESPONDER, so
    // the literal list gains them. The assertion against the domain's
    // MESSAGE_KINDS is unchanged.
    expect(messageKinds).toEqual([
      'LOST_CONTACT',
      'BACK_IN_CONTACT',
      'HOME',
      'ACKNOWLEDGED',
      'LOST_CONTACT_SMS',
      'NO_RESPONDER',
      'SAFE',
      'EXPIRED',
    ]);
    expect(messageKinds).toEqual([...MESSAGE_KINDS]);
    expect(await typeOf('outbox', 'kind')).toMatchObject({ udt_name: 'message_kind' });
  });

  test('LOST-07-AC19: alerts.sms_raised_at is a database time (timestamp with time zone), null on an alert put in without it', async () => {
    expect(await typeOf('alerts', 'sms_raised_at')).toEqual({
      data_type: 'timestamp with time zone',
      udt_name: 'timestamptz',
      is_nullable: 'YES',
    });

    const { journeyId } = await walking();
    const alertId = await insertAlert(journeyId, 'OPEN');
    const fresh = await connection().query<{ at: string | null }>(
      'select sms_raised_at::text as at from alerts where id = $1',
      [alertId],
    );
    expect(fresh.rows).toEqual([{ at: null }]);
  });

  test('LOST-07-AC19: the database takes an ESCALATED alert without an escalation time, and an escalation time on an alert in any state, as no check ties the state to it', async () => {
    // Rows put in directly are ESCALATED with none, and the resumed-escalation
    // rule will move a state back (approach item 9).
    const { journeyId } = await walking();
    const escalatedWithout = await insertAlert(journeyId, 'ESCALATED');
    const stored = await connection().query<{ state: string; at: string | null }>(
      'select state::text as state, sms_raised_at::text as at from alerts where id = $1',
      [escalatedWithout],
    );
    expect(stored.rows).toEqual([{ state: 'ESCALATED', at: null }]);

    for (const state of ['OPEN', 'ESCALATED', 'ACKNOWLEDGED']) {
      const alertId = await insertAlert((await walking()).journeyId, state);
      await expect(
        connection().query('update alerts set sms_raised_at = now() where id = $1', [alertId]),
        state,
      ).resolves.toMatchObject({ rowCount: 1 });
    }
    const resolved = await insertResolvedAlert((await walking()).journeyId, {
      resolvedAt: true,
      resolution: 'BACK_IN_CONTACT',
    });
    await expect(
      connection().query('update alerts set sms_raised_at = now() where id = $1', [resolved]),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  test('LOST-07-AC19: the claim’s partial index still reads (next_attempt_at, id) with the predicate sent_at IS NULL (pg_get_indexdef), and no partial index on outbox names a kind', async () => {
    // One index for both claims: the SMS claim filters the same unsent rows
    // by kind (approach item 9, "No index").
    const index = await connection().query<{ definition: string }>(
      `select pg_get_indexdef(indexrelid) as definition from pg_index
        where indexrelid = to_regclass('outbox_unsent_due_index')`,
    );
    const partial = await connection().query<{ definition: string }>(
      `select pg_get_indexdef(indexrelid) as definition from pg_index
        where indrelid = 'outbox'::regclass and indpred is not null`,
    );

    expect(index.rows.map(({ definition }) => definition)).toEqual([
      'CREATE INDEX outbox_unsent_due_index ON public.outbox USING btree (next_attempt_at, id) WHERE (sent_at IS NULL)',
    ]);
    expect(partial.rows.filter(({ definition }) => /kind/i.test(definition))).toEqual([]);
  });

  test('LOST-07-AC4: a second LOST_CONTACT_SMS for the same alert and recipient is refused by the database itself; one for another recipient, and the same recipient’s LOST_CONTACT push, are taken', async () => {
    const { journeyId } = await walking();
    const alertId = await insertAlert(journeyId, 'ESCALATED');
    const recipientId = await addUser();

    await expect(
      insertMessage({ alertId, recipientId, kind: 'LOST_CONTACT_SMS' }),
    ).resolves.toBeDefined();
    await expect(
      insertMessage({ alertId, recipientId, kind: 'LOST_CONTACT_SMS' }),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      insertMessage({ alertId, recipientId: await addUser(), kind: 'LOST_CONTACT_SMS' }),
    ).resolves.toBeDefined();
    await expect(
      insertMessage({ alertId, recipientId, kind: 'LOST_CONTACT' }),
    ).resolves.toBeDefined();
  });

  test('LOST-07-AC8: no column of alerts or outbox holds a coordinate, an accuracy, a phone time, a battery level, a name or a phone number; alerts.sms_raised_at is there; and the only columns named like a coordinate, in every table, are still positions.latitude and positions.longitude (information_schema)', async () => {
    const columnsOf = async (table: string) =>
      (
        await connection().query<{ column_name: string }>(
          `select column_name from information_schema.columns
            where table_schema = 'public' and table_name = $1 order by column_name`,
          [table],
        )
      ).rows.map(({ column_name }) => column_name);
    const alerts = await columnsOf('alerts');
    const outbox = await columnsOf('outbox');
    const coordinates = await connection().query<{ found: string }>(
      `select table_schema || '.' || table_name || '.' || column_name as found
         from information_schema.columns
        where table_schema not in ('pg_catalog', 'information_schema')
          and column_name ~* '(lat|lng|lon|coords|position|location)'
        order by 1`,
    );

    // There, so the scan below has read the table the migration changed.
    expect(alerts).toContain('sms_raised_at');
    expect(
      [...alerts, ...outbox].filter((column) =>
        /lat|lng|lon|coord|position|location|accuracy|recorded|battery|phone|msisdn|number|name/i.test(
          column,
        ),
      ),
    ).toEqual([]);
    expect(coordinates.rows.map(({ found }) => found)).toEqual([
      'public.positions.latitude',
      'public.positions.longitude',
    ]);
  });
});

// ---------------------------------------------------------------------------
// SM-10-AC7, AC14 and AC21: the database agrees with the removal (migration
// 0007, its spec's approach item 9): a round on every alert and message, in
// the outbox's unique key; the walker's warning a journey's message, naming
// exactly one of an alert and a journey; and NO_RESPONDER, last.
// ---------------------------------------------------------------------------

/** An outbox message put in directly, naming the alert, the journey, or both or neither, in a round if given. */
function insertOwnedMessage({
  alertId = null,
  journeyId = null,
  recipientId,
  kind,
  round,
}: {
  alertId?: string | null;
  journeyId?: string | null;
  recipientId: string;
  kind: string;
  round?: number;
}) {
  return round === undefined
    ? connection().query(
        `insert into outbox (id, alert_id, journey_id, recipient_id, kind, created_at, attempts,
                             next_attempt_at)
         values ($1, $2, $3, $4, $5, now(), 0, now())`,
        [syntheticUuid(), alertId, journeyId, recipientId, kind],
      )
    : connection().query(
        `insert into outbox (id, alert_id, journey_id, recipient_id, kind, created_at, attempts,
                             next_attempt_at, round)
         values ($1, $2, $3, $4, $5, now(), 0, now(), $6)`,
        [syntheticUuid(), alertId, journeyId, recipientId, kind, round],
      );
}

/** A table's column as information_schema describes it: its type, whether it takes null, and its default. */
async function columnOf(table: string, column: string) {
  const result = await connection().query<{
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    `select data_type, is_nullable, column_default from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [table, column],
  );
  return result.rows[0];
}

describe('SM-10 and SM-02: the database agrees on the round, the walker’s warning and its kind', () => {
  test('SM-10-AC7: the database refuses a second message of one kind for the same alert, recipient and round (23505), and takes one in another round, and one of another kind; it refuses a round under 1 on outbox and on alerts (23514) (LOST-06, LOST-07)', async () => {
    const { journeyId } = await walking();
    const alertId = await insertAlert(journeyId, 'ESCALATED');
    const recipientId = await addUser();
    const sms = { alertId, recipientId, kind: 'LOST_CONTACT_SMS' };

    await expect(insertOwnedMessage({ ...sms, round: 1 })).resolves.toBeDefined();
    await expect(insertOwnedMessage({ ...sms, round: 1 })).rejects.toMatchObject({
      code: '23505',
    });
    // The default round is 1: a message put in naming none is the same round.
    await expect(insertOwnedMessage(sms)).rejects.toMatchObject({ code: '23505' });
    await expect(insertOwnedMessage({ ...sms, round: 2 })).resolves.toBeDefined();
    await expect(insertOwnedMessage({ ...sms, round: 2 })).rejects.toMatchObject({
      code: '23505',
    });
    await expect(
      insertOwnedMessage({ alertId, recipientId, kind: 'ACKNOWLEDGED', round: 2 }),
    ).resolves.toBeDefined();

    for (const round of [0, -1]) {
      await expect(
        insertOwnedMessage({ ...sms, round }),
        `outbox, round ${String(round)}`,
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        connection().query('update alerts set round = $2 where id = $1', [alertId, round]),
        `alerts, round ${String(round)}`,
      ).rejects.toMatchObject({ code: '23514' });
    }
    await expect(
      connection().query('update alerts set round = 2 where id = $1', [alertId]),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  test('SM-10-AC14: the database refuses an outbox row naming both an alert and a journey, or neither (23514); it takes one naming either alone; a journey ID no journey has is refused (23503) (SM-02)', async () => {
    const { device, journeyId } = await walking();
    const alertId = await insertAlert(journeyId, 'OPEN');
    const walkerId = device.userId;

    await expect(
      insertOwnedMessage({ alertId, journeyId, recipientId: walkerId, kind: 'NO_RESPONDER' }),
      'both',
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertOwnedMessage({ recipientId: walkerId, kind: 'NO_RESPONDER' }),
      'neither',
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertOwnedMessage({
        journeyId: syntheticUuid(),
        recipientId: walkerId,
        kind: 'NO_RESPONDER',
      }),
      'no such journey',
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      insertOwnedMessage({ journeyId, recipientId: walkerId, kind: 'NO_RESPONDER' }),
      'the journey alone',
    ).resolves.toBeDefined();
    await expect(
      insertOwnedMessage({ alertId, recipientId: await addUser(), kind: 'LOST_CONTACT' }),
      'the alert alone',
    ).resolves.toBeDefined();
  });

  // RG-03 (LOST-08, named in the spec's "Existing assertions that change by
  // design"): this was "…in order, NO_RESPONDER last (pg_enum)…". Migration
  // 0008 adds SAFE and EXPIRED after it, so the title no longer says
  // NO_RESPONDER is last, and says where it stands instead.
  test('SM-10-AC21: message_kind’s values equal MESSAGE_KINDS, in order, NO_RESPONDER right after LOST_CONTACT_SMS (pg_enum); outbox.kind is of that type', async () => {
    const messageKinds = await labelsOf('message_kind');

    // The spec's own list first, so a domain list that drifted with the
    // database cannot carry both along.
    // RG-03 (LOST-08, named in the spec's "Existing assertions that change by
    // design"): migration 0008 adds SAFE and EXPIRED after NO_RESPONDER, so
    // the literal list gains them. The assertion against the domain's
    // MESSAGE_KINDS is unchanged.
    expect(messageKinds).toEqual([
      'LOST_CONTACT',
      'BACK_IN_CONTACT',
      'HOME',
      'ACKNOWLEDGED',
      'LOST_CONTACT_SMS',
      'NO_RESPONDER',
      'SAFE',
      'EXPIRED',
    ]);
    expect(messageKinds).toEqual([...MESSAGE_KINDS]);
    expect(await typeOf('outbox', 'kind')).toMatchObject({ udt_name: 'message_kind' });
  });

  test('SM-10-AC21: alerts.round and outbox.round are integers, not null, default 1; outbox.alert_id is nullable; outbox.journey_id is a nullable uuid referencing journeys; an alert and a message put in naming no round read 1', async () => {
    for (const table of ['alerts', 'outbox']) {
      expect(await columnOf(table, 'round'), `${table}.round`).toEqual({
        data_type: 'integer',
        is_nullable: 'NO',
        column_default: '1',
      });
    }
    expect(await typeOf('outbox', 'alert_id')).toMatchObject({ is_nullable: 'YES' });
    expect(await typeOf('outbox', 'journey_id')).toEqual({
      data_type: 'uuid',
      udt_name: 'uuid',
      is_nullable: 'YES',
    });
    const references = await connection().query<{ referenced: string; columns: string[] }>(
      `select c.confrelid::regclass::text as referenced,
              array(select a.attname::text from unnest(c.conkey) as k(attnum)
                      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
                as columns
         from pg_constraint c
        where c.conrelid = 'outbox'::regclass and c.contype = 'f'`,
    );
    expect(references.rows).toContainEqual({ referenced: 'journeys', columns: ['journey_id'] });

    const { journeyId } = await walking();
    const alertId = await insertAlert(journeyId, 'OPEN');
    await insertMessage({ alertId, recipientId: await addUser() });
    const rounds = await connection().query<{ alert: number; message: number }>(
      `select a.round::int as alert, o.round::int as message
         from alerts a join outbox o on o.alert_id = a.id where a.id = $1`,
      [alertId],
    );
    expect(rounds.rows).toEqual([{ alert: 1, message: 1 }]);
  });

  test('SM-10-AC21: the outbox’s one unique key is outbox_alert_id_recipient_id_kind_round_unique, on (alert_id, recipient_id, kind, round), and the old key is gone; the claim’s partial index still reads (next_attempt_at, id) with the predicate sent_at IS NULL (pg_get_indexdef)', async () => {
    const unique = await connection().query<{ name: string; columns: string[] }>(
      `select c.conname::text as name,
              array(select a.attname::text
                      from unnest(c.conkey) with ordinality as k(attnum, ord)
                      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
                     order by k.ord) as columns
         from pg_constraint c
        where c.conrelid = 'outbox'::regclass and c.contype = 'u'`,
    );
    const index = await connection().query<{ definition: string }>(
      `select pg_get_indexdef(indexrelid) as definition from pg_index
        where indexrelid = to_regclass('outbox_unsent_due_index')`,
    );

    expect(unique.rows).toEqual([
      {
        name: 'outbox_alert_id_recipient_id_kind_round_unique',
        columns: ['alert_id', 'recipient_id', 'kind', 'round'],
      },
    ]);
    expect(index.rows.map(({ definition }) => definition)).toEqual([
      'CREATE INDEX outbox_unsent_due_index ON public.outbox USING btree (next_attempt_at, id) WHERE (sent_at IS NULL)',
    ]);
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC20: the database agrees with the close's and the 24-hour end's
// lists.
// ---------------------------------------------------------------------------

describe('LOST-08 and SM-06: the database agrees on the two new resolutions, end reasons and stand-downs', () => {
  test('LOST-08-AC20: alert_resolution, message_kind and journey_end_reason hold exactly ALERT_RESOLUTIONS, MESSAGE_KINDS and JOURNEY_END_REASONS, in order (pg_enum), SAFE and EXPIRED last in each (SM-06)', async () => {
    const alertResolutions = await labelsOf('alert_resolution');
    const messageKinds = await labelsOf('message_kind');
    const journeyEndReasons = await labelsOf('journey_end_reason');

    // The spec's own lists first, so a domain list that drifted with the
    // database cannot carry both along.
    expect({ alertResolutions, messageKinds, journeyEndReasons }).toEqual({
      alertResolutions: ['BACK_IN_CONTACT', 'HOME', 'SAFE', 'EXPIRED'],
      messageKinds: [
        'LOST_CONTACT',
        'BACK_IN_CONTACT',
        'HOME',
        'ACKNOWLEDGED',
        'LOST_CONTACT_SMS',
        'NO_RESPONDER',
        'SAFE',
        'EXPIRED',
      ],
      journeyEndReasons: ['HOME', 'SAFE', 'EXPIRED'],
    });
    expect({ alertResolutions, messageKinds, journeyEndReasons }).toEqual({
      alertResolutions: [...ALERT_RESOLUTIONS],
      messageKinds: [...MESSAGE_KINDS],
      journeyEndReasons: [...JOURNEY_END_REASONS],
    });
  });

  test('LOST-08-AC20: SAFE and EXPIRED are taken as a resolution, as an end reason and as a message kind; a resolution or an end reason outside the lists is refused by the database itself (SM-06)', async () => {
    for (const value of ['SAFE', 'EXPIRED']) {
      const { journeyId } = await walking();
      const alertId = await insertResolvedAlert(journeyId, { resolvedAt: true, resolution: value });
      await expect(
        setJourneyEnd(journeyId, { endedAt: true, endReason: value }),
        `${value} as an end reason`,
      ).resolves.toBeDefined();
      await expect(
        seedMessage({
          alertId,
          recipientId: await addUser(),
          kind: value,
          createdAt: EARLIER,
          nextAttemptAt: EARLIER,
        }),
        `${value} as a message kind`,
      ).resolves.toBeDefined();
      expect(await resolutionsOf(journeyId), `${value} as a resolution`).toMatchObject([
        { alertId, resolution: value },
      ]);
    }

    const { journeyId } = await walking();
    for (const outside of ['ACKNOWLEDGED', 'NO_RESPONDER', 'CLOSED', 'safe']) {
      await expect(
        insertResolvedAlert(journeyId, { resolvedAt: true, resolution: outside }),
        `${outside} as a resolution`,
      ).rejects.toMatchObject(REFUSED_BY_THE_DATABASE);
      await expect(
        setJourneyEnd(journeyId, { endedAt: true, endReason: outside }),
        `${outside} as an end reason`,
      ).rejects.toMatchObject(REFUSED_BY_THE_DATABASE);
    }
    await expect(
      setJourneyEnd(journeyId, { endedAt: true, endReason: 'BACK_IN_CONTACT' }),
      'a resolution that ends no journey',
    ).rejects.toMatchObject(REFUSED_BY_THE_DATABASE);
  });
});
