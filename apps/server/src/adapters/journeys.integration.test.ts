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
// the real authenticator finds them.
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
  syntheticCredential,
  syntheticUuid,
  type FakeJourneyState,
  type JourneyAsStored,
  type JourneyStoreUnderTest,
} from '@trygghverdag/test-kit';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../api.ts';
import { JOURNEY_STATES, type JourneyState } from '../domain/journey.ts';
import { createHealthService } from '../modules/health/service.ts';
import { createJourneyService } from '../modules/journeys/service.ts';
import { databaseClock } from './clock.ts';
import { createDatabase, createPool, type Database } from './db.ts';
import { databaseDeviceAuthenticator, hashCredential } from './device-credentials.ts';
import { databaseJourneyStore } from './journeys.ts';
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

/** A user with a device, and the credential that device would send. */
async function walker(): Promise<{ userId: string; deviceId: string; credential: string }> {
  const userId = await addUser();
  const deviceId = syntheticUuid();
  const credential = syntheticCredential();
  await connection().query(
    'insert into devices (id, user_id, credential_hash) values ($1, $2, $3)',
    [deviceId, userId, hashCredential(credential)],
  );
  return { userId, deviceId, credential };
}

/** A journey written straight into the tables, in any state, with its responders. */
async function seedJourney({
  walkerId,
  state,
  responderIds,
  startedAt,
}: {
  walkerId: string;
  state: FakeJourneyState;
  responderIds: readonly string[];
  startedAt: Date;
}): Promise<string> {
  const id = syntheticUuid();
  const client = await connection().connect();
  try {
    await client.query('begin');
    await client.query(
      'insert into journeys (id, walker_id, state, started_at) values ($1, $2, $3, $4)',
      [id, walkerId, state, startedAt],
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

/** The database's own now, to the millisecond, floored as a Date floors it. */
async function databaseNowMs(): Promise<number> {
  const result = await connection().query<{ ms: string }>(
    'select floor(extract(epoch from now()) * 1000)::bigint::text as ms',
  );
  return Number(result.rows[0]?.ms);
}

// ---------------------------------------------------------------------------
// The API, with every real adapter.
// ---------------------------------------------------------------------------

function realApi() {
  const clock = databaseClock(database());
  return createApi({
    health: createHealthService({ clock, heartbeats: databaseWorkerHeartbeats(database()) }),
    journeys: createJourneyService({ clock, journeys: databaseJourneyStore(database()) }),
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
    seedJourney,
    journeysOf,
  });

  test.each(JOURNEY_STORE_BEHAVIOUR)(
    '$name',
    async ({ run }) => {
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
      const walkerId = await addUser();
      await seedJourney({ walkerId, state: existing, responderIds: [], startedAt: EARLIER });

      for (const second of UNENDED_STATES) {
        await expect(
          seedJourney({ walkerId, state: second, responderIds: [], startedAt: EARLIER }),
          `${existing} then ${second}`,
        ).rejects.toMatchObject({ code: '23505', constraint: ONE_UNENDED_INDEX });
      }
      await expect(
        seedJourney({ walkerId, state: 'ENDED', responderIds: [], startedAt: EARLIER }),
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
    for (const state of JOURNEY_STATES) {
      const walkerId = await addUser();
      await expect(
        connection().query(
          'insert into journeys (id, walker_id, state, started_at) values ($1, $2, $3, now())',
          [syntheticUuid(), walkerId, state],
        ),
        state,
      ).resolves.toBeDefined();
    }
    for (const state of ['PAUSED', 'ended', 'active', '']) {
      const walkerId = await addUser();
      await expect(
        connection().query(
          'insert into journeys (id, walker_id, state, started_at) values ($1, $2, $3, now())',
          [syntheticUuid(), walkerId, state],
        ),
        state,
      ).rejects.toThrow();
    }
  });
});
