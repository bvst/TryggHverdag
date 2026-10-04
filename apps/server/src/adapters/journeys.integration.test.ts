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
  type AlertAsStored,
  type FakeJourneyState,
  type FakeLog,
  type HeartbeatAsStored,
  type MessageAsStored,
  type HeartbeatToRecord,
  type JourneyAsStored,
  type JourneyStoreUnderTest,
  type PositionAsStored,
  type SyntheticHeartbeat,
} from '@trygghverdag/test-kit';
import { sql } from 'drizzle-orm';
import { inspect } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../api.ts';
import { captured, markersIn, markersOf } from '../capture.test.ts';
import { ALERT_STATES, JOURNEY_STATES, type JourneyState } from '../domain/journey.ts';
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

/** Ends a journey directly: nothing in the code can end one yet. */
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

// ---------------------------------------------------------------------------
// The API, with every real adapter.
// ---------------------------------------------------------------------------

function realApi(log: FakeLog = fakeLog()) {
  const clock = databaseClock(database());
  return createApi({
    health: createHealthService({ clock, heartbeats: databaseWorkerHeartbeats(database()) }),
    journeys: createJourneyService({ clock, journeys: databaseJourneyStore(database()), log }),
    devices: databaseDeviceAuthenticator(database()),
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
    // now() moves on while a behaviour runs: a silence this close to the
    // threshold could fall either side of it by the time the store asks.
    timeMarginMs: 2_000,
  });

  test.each(JOURNEY_STORE_BEHAVIOUR)(
    '$name',
    async ({ name, run }) => {
      // LOST-02: a claim takes the due messages of the whole table, and other
      // behaviours leave theirs due. So before each of the outbox's
      // behaviours, every message already there is put out of reach, as sent;
      // only LOST-02's behaviours touch the outbox, and only they need it.
      if (name.startsWith('LOST-02-')) {
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

    expect(alerts).toEqual(['id', 'journey_id', 'opened_at', 'silent_since', 'state'].sort());
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
      ].sort(),
    );
    expect(
      [...alerts, ...outbox].filter((column) =>
        /lat|lng|lon|coord|position|location|accuracy|recorded|battery|phone|name/i.test(column),
      ),
    ).toEqual([]);
  });
});
