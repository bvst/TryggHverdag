// L3 server integration. A real PostgreSQL in a container, the real migrations,
// the real SQL.
//
// These tests exist because the things that break here cannot break anywhere
// else: an upsert that is really two statements racing, a timestamp that loses
// its zone on the way through the driver, a clock read that turns out to be the
// test machine's rather than the database's. None of that is visible to a unit
// test with a fake, and all of it decides whether an alert fires on time.
//
// Needs Docker. `pnpm run test:unit` deliberately leaves this file out, so a
// machine without Docker gets a fast honest answer instead of a confusing
// failure; `pnpm run test:integration` is where it runs, and CI always has it.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  endTestPool,
  fakeLog,
  syntheticBatteryLevel,
  syntheticCredential,
  syntheticEventId,
  syntheticUuid,
} from '@trygghverdag/test-kit';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { run } from 'graphile-worker';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { IDLE_IN_TRANSACTION_LIMIT_MS } from '../domain/watchdog.ts';
import { createWatchdog } from '../modules/alerts/watchdog.ts';
import { databaseClock } from './clock.ts';
import { POOL_SIZE, createDatabase, createPool, type Database } from './db.ts';
import { hashCredential } from './device-credentials.ts';
import { HeartbeatStoreError, databaseJourneyStore } from './journeys.ts';
import { databaseWorkerHeartbeats } from './worker-heartbeats.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'db', 'migrations');

// Undefined until beforeAll succeeds — and afterAll runs even when it did not,
// so the cleanup below has to cope with a container that never started.
let container: StartedPostgreSqlContainer | undefined;
let pool: pg.Pool | undefined;
let db: Database | undefined;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  pool = createPool(container.getConnectionUri(), POOL_SIZE.worker);
  db = createDatabase(pool);
  // The same migrations that run in staging and production. A test that built
  // its tables by hand would prove the code works against a schema nobody ships.
  await migrate(db, { migrationsFolder: MIGRATIONS });
}, 180_000);

afterAll(async () => {
  // endTestPool, not pool.end() alone: the pool's sockets are still closing
  // when end() resolves, and stopping the container then hands the pool a
  // 57P01 it has no listener for, which fails the run with every test
  // passed. The test kit says why; the production pool keeps none (D-068).
  await endTestPool(pool);
  await container?.stop();
});

function database(): Database {
  if (db === undefined) {
    throw new Error('The container did not start, so there is nothing to test against.');
  }
  return db;
}

function connectionUri(): string {
  if (container === undefined) {
    throw new Error('The container did not start, so there is nothing to connect to.');
  }
  return container.getConnectionUri();
}

function connection(): pg.Pool {
  if (pool === undefined) {
    throw new Error('The container did not start, so there is nothing to query.');
  }
  return pool;
}

describe('databaseClock', () => {
  test('REL-01: the time comes from the database, not from this process', async () => {
    const clock = databaseClock(database());

    const fromDatabase = await clock.now();

    expect(fromDatabase).toBeInstanceOf(Date);
    // Loose on purpose: the point is that it is a real, current time, not that
    // it matches this machine's clock — the two are allowed to differ, and
    // REL-01 says the database's is the one that counts.
    expect(Math.abs(fromDatabase.getTime() - Date.now())).toBeLessThan(60_000);
  });

  test('REL-01: the database clock moves forward between two reads', async () => {
    const clock = databaseClock(database());

    const first = await clock.now();
    const second = await clock.now();

    expect(second.getTime()).toBeGreaterThanOrEqual(first.getTime());
  });

  test('BUG-10: REL-01: inside one transaction the clock answers the time the database froze for it, not the later time this process has moved on to (D-097)', async () => {
    // The first test above would pass a process clock: `new Date()` is within
    // 60 s of Date.now() too. This one tells the two apart. PostgreSQL's now()
    // is the moment the transaction started and stays that until it ends, while
    // a process clock keeps moving, so after a wait inside one transaction the
    // clock must give back exactly what now() said before it.
    //
    // databaseClock takes a Database, and a Drizzle transaction is not one: it
    // has no $client. So the transaction is held on the one connection of a
    // pool of one, and the clock is given a Database on that same pool: every
    // query it makes goes down that connection, inside that transaction. Had
    // its query reached any other connection, now() there would be later and
    // this would fail rather than pass.
    const single = createPool(connectionUri(), 1);
    try {
      await single.query('begin');
      const started = await single.query<{ now: Date }>('select now() as now');
      const frozen = started.rows[0]?.now;
      await new Promise((resolve) => setTimeout(resolve, 25));

      const read = await databaseClock(createDatabase(single)).now();

      const ended = await single.query<{ wall: Date; now: Date }>(
        'select clock_timestamp() as wall, now() as now',
      );
      await single.query('rollback');
      const after = ended.rows[0];

      if (frozen === undefined || after === undefined) {
        throw new Error(
          'The database did not say what time it was, so there is nothing to compare.',
        );
      }
      expect(read.toISOString()).toBe(frozen.toISOString());
      // What makes the line above mean something: the database's own wall
      // clock did move on during the wait, and the connection stayed in the
      // same transaction throughout, its now() unmoved.
      expect(after.wall.getTime() - frozen.getTime()).toBeGreaterThanOrEqual(20);
      expect(after.now.toISOString()).toBe(frozen.toISOString());
    } finally {
      await endTestPool(single);
    }
  });
});

describe('databaseWorkerHeartbeats', () => {
  test('reports no beat before the worker has ever run', async () => {
    const heartbeats = databaseWorkerHeartbeats(database());

    expect(await heartbeats.lastBeat()).toBeNull();
  });

  test('a beat survives the round trip with its moment intact', async () => {
    const heartbeats = databaseWorkerHeartbeats(database());
    const at = new Date('2026-09-23T22:15:00.000Z');

    await heartbeats.record(at);

    expect((await heartbeats.lastBeat())?.toISOString()).toBe(at.toISOString());
  });

  test('beating again updates the row instead of failing on the primary key', async () => {
    // The worker beats every minute forever. If this were a plain insert it
    // would work once and then throw on every subsequent beat — and the API
    // would report the system as degraded while the worker was in fact running
    // perfectly, which is the most expensive kind of false alarm.
    const heartbeats = databaseWorkerHeartbeats(database());
    const later = new Date('2026-09-23T22:16:00.000Z');

    await heartbeats.record(new Date('2026-09-23T22:15:00.000Z'));
    await heartbeats.record(later);

    expect((await heartbeats.lastBeat())?.toISOString()).toBe(later.toISOString());
  });

  test('there is still only one row after many beats', async () => {
    // The upsert has to keep updating the same row. A version that inserted
    // would grow a row a minute and make `lastBeat` a question of which row
    // came back first.
    const heartbeats = databaseWorkerHeartbeats(database());

    for (let i = 0; i < 5; i += 1) {
      await heartbeats.record(new Date(Date.UTC(2026, 8, 23, 22, 20 + i)));
    }

    const counted = await connection().query<{ count: string }>(
      'select count(*) from worker_heartbeat',
    );
    expect(counted.rows[0]?.count).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// LOST-02: the pools' session limits and listeners, against a real server.
//
// These come last on purpose: a sweep records the worker beat, and the
// databaseWorkerHeartbeats tests above start from a database that has none.
// ---------------------------------------------------------------------------

/** A limit set short for the test, so PostgreSQL acts on it within a test's time. */
const SHORT_LIMIT_MS = 500;

/** How far past a limit PostgreSQL may act and still count as on time. */
const MARGIN_MS = 2_500;

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Waits, in short sleeps, until `check` holds or the attempts run out (about 10 s). */
async function eventually(check: () => Promise<boolean>, attempts = 400): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) {
      return true;
    }
    await sleep(25);
  }
  return check();
}

/**
 * An ACTIVE journey with one responder, its last contact six minutes before
 * the database's now(): overdue by LOST-02's rule. Synthetic IDs throughout.
 */
async function overdueJourney(): Promise<string> {
  const walkerId = syntheticUuid();
  const responderId = syntheticUuid();
  const deviceId = syntheticUuid();
  const journeyId = syntheticUuid();
  await connection().query('insert into users (id) values ($1), ($2)', [walkerId, responderId]);
  await connection().query(
    'insert into devices (id, user_id, credential_hash) values ($1, $2, $3)',
    [deviceId, walkerId, hashCredential(syntheticCredential())],
  );
  await connection().query(
    `insert into journeys (id, walker_id, device_id, state, started_at, last_heartbeat_at)
     values ($1, $2, $3, 'ACTIVE', now() - interval '30 minutes', now() - interval '6 minutes')`,
    [journeyId, walkerId, deviceId],
  );
  await connection().query(
    'insert into journey_responders (journey_id, responder_id) values ($1, $2)',
    [journeyId, responderId],
  );
  return journeyId;
}

async function stateOf(journeyId: string): Promise<string | undefined> {
  const result = await connection().query<{ state: string }>(
    'select state::text as state from journeys where id = $1',
    [journeyId],
  );
  return result.rows[0]?.state;
}

async function contactOf(journeyId: string): Promise<{ heartbeats: number; lastContact: string }> {
  const result = await connection().query<{ heartbeats: number; last_contact: string }>(
    `select (select count(*)::int from heartbeats where journey_id = $1) as heartbeats,
            last_heartbeat_at::text as last_contact
       from journeys where id = $1`,
    [journeyId],
  );
  const row = result.rows[0];
  return { heartbeats: row?.heartbeats ?? Number.NaN, lastContact: row?.last_contact ?? '' };
}

async function sessionIsShown(pid: number | undefined): Promise<boolean> {
  const result = await connection().query<{ n: number }>(
    'select count(*)::int as n from pg_stat_activity where pid = $1',
    [pid],
  );
  return result.rows[0]?.n === 1;
}

/** A psql-like session: its own connection, outside every pool, with no limit. */
async function outsider(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: connectionUri() });
  await client.connect();
  return client;
}

function sweeper() {
  return createWatchdog({
    journeys: databaseJourneyStore(database()),
    beats: databaseWorkerHeartbeats(database()),
    log: fakeLog(),
  });
}

describe('LOST-02: a stalled transaction is ended, and a heartbeat never waits for long', () => {
  test('LOST-02-AC17: a transaction on a pool made as the worker makes it, its idle limit set short, that locks overdue J’s row and sends nothing more is ended by PostgreSQL within the limit plus a margin: its next query rejects, pg_stat_activity no longer shows it, one database_error line carries 25P03, and the next sweep opens J’s alert', async () => {
    const journeyId = await overdueJourney();
    const log = fakeLog();
    const limited = createPool(connectionUri(), 2, {
      name: 'worker',
      log,
      idleInTransactionMs: SHORT_LIMIT_MS,
    });
    let ended: boolean | undefined;
    let tookMs: number | undefined;
    let nextQuery: unknown;
    try {
      const client = await limited.connect();
      try {
        await client.query('begin');
        await client.query('select id from journeys where id = $1 for update', [journeyId]);
        const pid = (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]
          ?.pid;
        const idleFrom = performance.now();
        ended = await eventually(async () => !(await sessionIsShown(pid)));
        tookMs = performance.now() - idleFrom;
        nextQuery = await client.query('select 1').then(
          () => 'answered',
          (error: unknown) => error,
        );
      } finally {
        client.release(true);
      }
      await sleep(200);
    } finally {
      await endTestPool(limited);
    }

    expect(ended).toBe(true);
    expect(tookMs).toBeLessThan(SHORT_LIMIT_MS + MARGIN_MS);
    expect(nextQuery).toBeInstanceOf(Error);
    expect(log.events).toEqual([{ event: 'database_error', pool: 'worker', code: '25P03' }]);
    expect((await sweeper().sweep()).opened).toBe(1);
    expect(await stateOf(journeyId)).toBe('LOST_CONTACT');
  }, 30_000);

  test('LOST-02-AC17: while a session outside the pools holds J’s row, recordHeartbeat through a pool made as the API makes it, its lock limit set short, rejects within the limit plus a margin with a HeartbeatStoreError whose code is 55P03, and stores nothing', async () => {
    const journeyId = await overdueJourney();
    const before = await contactOf(journeyId);
    const apiPool = createPool(connectionUri(), 2, {
      name: 'api',
      log: fakeLog(),
      idleInTransactionMs: IDLE_IN_TRANSACTION_LIMIT_MS,
      lockTimeoutMs: SHORT_LIMIT_MS,
    });
    const receivedAt = await databaseClock(database()).now();
    const holder = await outsider();
    let answer: unknown = 'still waiting';
    let tookMs = Number.POSITIVE_INFINITY;
    try {
      await holder.query('begin');
      await holder.query('select id from journeys where id = $1 for update', [journeyId]);
      const started = performance.now();
      const answering = databaseJourneyStore(createDatabase(apiPool))
        .recordHeartbeat({
          journeyId,
          eventId: syntheticEventId(),
          receivedAt,
          batteryLevel: syntheticBatteryLevel(),
          position: null,
        })
        .then(
          () => 'stored',
          (error: unknown) => error,
        )
        .then((settled) => {
          answer = settled;
          tookMs = performance.now() - started;
        });
      // Bounded, so a heartbeat that waits for as long as the row is held
      // shows up as a failed assertion here rather than as a hung test.
      await Promise.race([answering, sleep(SHORT_LIMIT_MS + MARGIN_MS)]);
      const answeredInTime = answer;
      await holder.query('rollback');
      await answering;
      answer = answeredInTime;
    } finally {
      await holder.end();
      await endTestPool(apiPool);
    }

    expect(answer).toBeInstanceOf(HeartbeatStoreError);
    expect((answer as HeartbeatStoreError).code).toBe('55P03');
    expect(tookMs).toBeLessThan(SHORT_LIMIT_MS + MARGIN_MS);
    expect(await contactOf(journeyId)).toEqual(before);
  }, 30_000);
});

describe('LOST-02: a connection’s error is one line, never a crash', () => {
  test('LOST-02-AC18: pg_terminate_backend on an idle connection of a pool made with a name and a log gives one database_error line with 57P01, and the pool serves the next query', async () => {
    const log = fakeLog();
    const named = createPool(connectionUri(), 2, { name: 'api', log });
    try {
      // Without a listener, the terminated idle connection's error would be
      // thrown out of the pool and fail the whole run, not this test: the
      // crash AC18 exists to prevent. Checked first, so a red run stops here.
      expect(named.listenerCount('error')).toBeGreaterThan(0);
      const pid = (await named.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]
        ?.pid;

      await connection().query('select pg_terminate_backend($1)', [pid]);

      expect(await eventually(() => Promise.resolve(log.events.length > 0))).toBe(true);
      await sleep(200);
      expect(log.events).toEqual([{ event: 'database_error', pool: 'api', code: '57P01' }]);
      expect((await named.query<{ one: number }>('select 1 as one')).rows).toEqual([{ one: 1 }]);
    } finally {
      await endTestPool(named);
    }
  });

  test('LOST-02-AC18: starting the real Graphile runner on a pool made as the worker makes it writes no "error handlers" warning, and leaves the pool’s error and connect listeners as createPool made them', async () => {
    const workerPool = createPool(connectionUri(), POOL_SIZE.worker, {
      name: 'worker',
      log: fakeLog(),
      idleInTransactionMs: IDLE_IN_TRANSACTION_LIMIT_MS,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const errorListeners = workerPool.listeners('error');
      const connectListeners = workerPool.listeners('connect');

      const runner = await run({
        pgPool: workerPool,
        noHandleSignals: true,
        concurrency: 1,
        taskList: {},
      });
      await runner.stop();

      const warnings = warn.mock.calls.map((call) => call.map(String).join(' '));
      expect(warnings.filter((text) => text.includes('error handlers'))).toEqual([]);
      expect(errorListeners.length).toBeGreaterThan(0);
      expect(connectListeners.length).toBeGreaterThan(0);
      expect(workerPool.listeners('error')).toEqual(errorListeners);
      expect(workerPool.listeners('connect')).toEqual(connectListeners);
    } finally {
      warn.mockRestore();
      await endTestPool(workerPool);
    }
  }, 60_000);
});
