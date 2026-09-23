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
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { databaseClock } from './clock.ts';
import { POOL_SIZE, createDatabase, createPool, type Database } from './db.ts';
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
  await pool?.end();
  await container?.stop();
});

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
