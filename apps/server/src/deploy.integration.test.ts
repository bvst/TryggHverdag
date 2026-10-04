// L3: the sequence a staging deploy runs, against the PostgreSQL version
// staging actually has.
//
// Clever Cloud's free DEV plan runs PostgreSQL 15 (15.18 when this was
// written), while the other integration tests use 17. A migration that relied
// on something newer than 15 would pass there and fail on the first deploy, so
// this file pins the version staging runs. Change it when staging's changes.
//
// The order is the platform's: the pre-run hook migrates, then the API and the
// worker start. Nothing is faked — the migrations, Graphile Worker's own schema,
// the heartbeat task and the health check all run for real.
//
// Needs Docker, like every *.integration.test.ts: CI runs it, a cloud session
// cannot.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  syntheticBatteryLevel,
  syntheticCredential,
  syntheticEventId,
  syntheticPosition,
  syntheticUuid,
} from '@trygghverdag/test-kit';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { addJobAdhoc } from 'graphile-worker';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startApiProcess } from './api-process.ts';
import { createDatabase, createPool } from './adapters/db.ts';
import { hashCredential } from './adapters/device-credentials.ts';
import { migrateDatabase } from './adapters/migrations.ts';
import { startWorker } from './worker.ts';

/** What Clever Cloud's DEV plan runs. See the note above before changing it. */
const STAGING_POSTGRES = 'postgres:15-alpine';

let container: StartedPostgreSqlContainer | undefined;

beforeAll(async () => {
  container = await new PostgreSqlContainer(STAGING_POSTGRES).start();
}, 180_000);

afterAll(async () => {
  await container?.stop();
});

function databaseUrl(): string {
  if (container === undefined) {
    throw new Error('The container did not start, so there is nothing to deploy against.');
  }
  return container.getConnectionUri();
}

async function health(port: number): Promise<{ status: string }> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/v1/health`);
  expect(response.status).toBe(200);
  return (await response.json()) as { status: string };
}

describe('a staging deploy, in order', () => {
  test('the migrations apply to an empty database', async () => {
    await expect(migrateDatabase(databaseUrl())).resolves.toBeUndefined();
  });

  test('and apply again without harm, because every deploy runs them', async () => {
    await expect(migrateDatabase(databaseUrl())).resolves.toBeUndefined();
  });

  test('the API then answers, and says degraded until the worker has checked in', async () => {
    const api = await startApiProcess({ databaseUrl: databaseUrl(), port: 0 });

    try {
      expect((await health(api.port)).status).toBe('degraded');
    } finally {
      await api.stop();
    }
  });

  test('once the worker has beaten, the API reports the system ok', async () => {
    // The heartbeat is a cron task, and the next minute boundary can be a
    // minute away. Queuing the same task by hand runs the real task list
    // through the real runner now, which is what this test is about.
    const api = await startApiProcess({ databaseUrl: databaseUrl(), port: 0 });
    const worker = await startWorker(databaseUrl());

    try {
      await addJobAdhoc({ connectionString: databaseUrl() }, 'heartbeat', {});

      // Up to 30 seconds, counted in attempts rather than read off a clock.
      let status = (await health(api.port)).status;
      for (let attempt = 0; status !== 'ok' && attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        status = (await health(api.port)).status;
      }

      expect(status).toBe('ok');
    } finally {
      await worker.stop();
      await api.stop();
    }
  }, 60_000);
});

/** Waits, in attempts rather than by a clock, until `check` holds or the attempts run out. */
async function eventually(check: () => Promise<boolean>, attempts = 120): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return check();
}

describe('stopping the worker process', () => {
  test('D-068: on SIGTERM the real worker exits with 0 and leaves no connection behind', async () => {
    // The unit tests prove this against a fake runner. safety-reviewer ran the
    // real one and found Graphile Worker's own signal handler killing the
    // process first — so this runs bin/worker.ts itself, as the platform does.
    // Its connections are tagged so they can be counted apart from this test's.
    const tag = 'deploy-test-worker';
    const workerUrl = `${databaseUrl()}?application_name=${tag}`;
    const probe = new pg.Client({ connectionString: databaseUrl() });
    await probe.connect();
    const connections = async () =>
      Number(
        (
          await probe.query<{ n: string }>(
            'select count(*) as n from pg_stat_activity where application_name = $1',
            [tag],
          )
        ).rows[0]?.n,
      );

    const worker = spawn(
      process.execPath,
      ['--experimental-strip-types', path.join(import.meta.dirname, 'bin', 'worker.ts')],
      {
        // Only what is given: the child must not inherit the runner's environment.
        env: { PATH: process.env['PATH'] ?? '', DATABASE_URL: workerUrl },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    worker.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    worker.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const exited = once(worker, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;

    try {
      expect(await eventually(async () => (await connections()) > 0)).toBe(true);

      worker.kill('SIGTERM');
      const [code, signal] = await exited;

      expect({ code, signal }).toEqual({ code: 0, signal: null });
      expect(output).not.toContain('worker failed');
      expect(await eventually(async () => (await connections()) === 0)).toBe(true);
    } finally {
      worker.kill('SIGKILL');
      await probe.end();
    }
  }, 90_000);
});

// ---------------------------------------------------------------------------
// LOST-01-AC20 (D-101): the migration that records each journey's device
// refuses to guess the device of a journey that already exists.
// ---------------------------------------------------------------------------
//
// No record says which device started a journey SM-01 stored, so any device
// written in would be a guess, and a wrong guess is D-101's own failure: a
// device that is not walking accepted, hiding the walking phone's silence, or
// the walking phone refused. So `0002` adds `device_id` not null, with no
// default and no update, and PostgreSQL refuses it on a table that holds a
// row. Drizzle applies every pending migration in one transaction, so the
// refusal leaves the database exactly as it was, and the deploy stops at the
// pre-run hook.

/** Where the real migrations live, as adapters/migrations.ts reads them. */
const MIGRATIONS = path.join(import.meta.dirname, 'db', 'migrations');

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function journal(folder: string): { entries: JournalEntry[] } & Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  } & Record<string, unknown>;
}

/** A copy of the migrations folder holding only `0000` and `0001`: the schema before LOST-01. */
function migrationsUpTo0001(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'migrations-0001-'));
  mkdirSync(path.join(folder, 'meta'));
  const real = journal(MIGRATIONS);
  const kept = real.entries.filter((entry) => /^000[01]_/.test(entry.tag));
  expect(kept.map((entry) => entry.idx)).toEqual([0, 1]);
  for (const entry of kept) {
    copyFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
  }
  writeFileSync(
    path.join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...real, entries: kept }, null, 2),
  );
  return folder;
}

function withDatabase(uri: string, name: string): string {
  const url = new URL(uri);
  url.pathname = `/${name}`;
  return url.toString();
}

/** A fresh database in the PostgreSQL 15 container, migrated up to `0001` only, and dropped afterwards. */
async function databaseAt0001(
  use: (uri: string, client: pg.Client) => Promise<void>,
): Promise<void> {
  const name = `lost01_${syntheticUuid().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: databaseUrl() });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const uri = withDatabase(databaseUrl(), name);
  const folder = migrationsUpTo0001();
  const client = new pg.Client({ connectionString: uri });
  try {
    const pool = createPool(uri, 1);
    try {
      await migrate(createDatabase(pool), { migrationsFolder: folder });
    } finally {
      await pool.end();
    }
    await client.connect();
    await use(uri, client);
  } finally {
    await client.end().catch(() => undefined);
    rmSync(folder, { recursive: true, force: true });
    await admin.query(`drop database if exists ${name}`);
    await admin.end();
  }
}

/** A synthetic user, their device, and nothing else. */
async function userWithDevice(client: pg.Client): Promise<{ userId: string; deviceId: string }> {
  const userId = syntheticUuid();
  const deviceId = syntheticUuid();
  await client.query('insert into users (id) values ($1)', [userId]);
  await client.query('insert into devices (id, user_id, credential_hash) values ($1, $2, $3)', [
    deviceId,
    userId,
    hashCredential(syntheticCredential()),
  ]);
  return { userId, deviceId };
}

/** What the database holds that the migration could change: every journey row, the tables, journeys' columns, and the migrations journal. */
async function snapshot(client: pg.Client) {
  const rows = async (text: string) =>
    (await client.query<{ value: string }>(text)).rows.map((row) => row.value);
  return {
    journeys: await rows('select row_to_json(j)::text as value from journeys j order by j.id'),
    responders: await rows(
      'select row_to_json(r)::text as value from journey_responders r order by r.journey_id',
    ),
    tables: await rows(
      "select table_name as value from information_schema.tables where table_schema = 'public' order by 1",
    ),
    journeyColumns: await rows(
      "select column_name as value from information_schema.columns where table_name = 'journeys' order by 1",
    ),
    journal: await rows(
      'select created_at::text as value from drizzle.__drizzle_migrations order by created_at',
    ),
  };
}

/** An error and every cause behind it. */
function causes(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = error;
  while (current !== undefined && current !== null && chain.length < 20) {
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

describe('D-101: the migration refuses to guess the device of a journey that already exists', () => {
  test('LOST-01-AC20: a PostgreSQL 15 database at 0001 holding one journey refuses the migrations, as the pre-run hook runs them, with 23502 naming device_id; and the database is exactly as it was', async () => {
    await databaseAt0001(async (uri, client) => {
      const { userId } = await userWithDevice(client);
      const responderId = syntheticUuid();
      await client.query('insert into users (id) values ($1)', [responderId]);
      const journeyId = syntheticUuid();
      await client.query(
        "insert into journeys (id, walker_id, state, started_at) values ($1, $2, 'ACTIVE', now())",
        [journeyId, userId],
      );
      await client.query(
        'insert into journey_responders (journey_id, responder_id) values ($1, $2)',
        [journeyId, responderId],
      );
      const before = await snapshot(client);
      expect(before.journeys).toHaveLength(1);
      expect(before.journal).toHaveLength(2);

      let refusal: unknown;
      try {
        await migrateDatabase(uri);
      } catch (error) {
        refusal = error;
      }

      expect(refusal, 'the migrations ran on a database holding a journey').toBeInstanceOf(Error);
      const notNull = causes(refusal).find(
        (cause) => (cause as { code?: unknown }).code === '23502',
      ) as { message?: string; column?: string } | undefined;
      expect(notNull, 'no error in the chain carries SQLSTATE 23502').toBeDefined();
      expect(`${notNull?.column ?? ''} ${notNull?.message ?? ''}`).toContain('device_id');
      // Whole: nothing of 0002 is left, and nothing was ended, deleted or given a device.
      expect(await snapshot(client)).toEqual(before);
      expect(before.journeyColumns).not.toContain('device_id');
      expect(before.tables).not.toContain('heartbeats');
      expect(before.tables).not.toContain('positions');
      expect(before.journal).toEqual(
        journal(MIGRATIONS)
          .entries.filter((entry) => /^000[01]_/.test(entry.tag))
          .map((entry) => String(entry.when)),
      );
    });
  }, 120_000);

  test('LOST-01-AC20: (control) the same database without the journey migrates cleanly, and journeys.device_id is then not null and references devices', async () => {
    await databaseAt0001(async (uri, client) => {
      await userWithDevice(client);

      await expect(migrateDatabase(uri)).resolves.toBeUndefined();

      const column = await client.query<{ is_nullable: string }>(
        "select is_nullable from information_schema.columns where table_name = 'journeys' and column_name = 'device_id'",
      );
      const references = await client.query<{ target: string }>(
        `select confrelid::regclass::text as target
           from pg_constraint
          where conrelid = 'journeys'::regclass and contype = 'f'
            and conkey = array[(select attnum from pg_attribute
                                 where attrelid = 'journeys'::regclass and attname = 'device_id')]`,
      );
      expect(column.rows).toEqual([{ is_nullable: 'NO' }]);
      expect(references.rows).toEqual([{ target: 'devices' }]);
      expect((await snapshot(client)).journal).toHaveLength(journal(MIGRATIONS).entries.length);
    });
  }, 120_000);

  test('LOST-01-AC20: the committed 0002 migration adds device_id with no default, and holds no update or delete of journeys, so a backfill added later fails here', () => {
    const files = readdirSync(MIGRATIONS).filter((file) => /^0002_.*\.sql$/.test(file));
    expect(files, 'exactly one 0002 migration').toHaveLength(1);
    const text = readFileSync(path.join(MIGRATIONS, files[0] ?? ''), 'utf8');
    const statements = text
      .split(/--> statement-breakpoint|;/)
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '');
    const addsDevice = statements.filter((statement) =>
      /\badd column\s+"?device_id"?/i.test(statement),
    );

    expect(addsDevice).toHaveLength(1);
    expect(addsDevice[0]).toMatch(/\bnot null\b/i);
    expect(addsDevice[0]).not.toMatch(/\bdefault\b/i);
    expect(text).not.toMatch(/\bupdate\s+("?public"?\.)?"?journeys"?/i);
    expect(text).not.toMatch(/\bdelete\s+from\s+("?public"?\.)?"?journeys"?/i);
    expect(text).not.toMatch(/\btruncate\b/i);
  });
});

// LOST-02's migration, 0003, adds the alerts and the outbox. Unlike 0002 it
// has nothing to guess, so it must run over a database that already holds
// journeys, in every state, with their heartbeats and positions, and change
// none of those rows. Staging's PostgreSQL, as everything in this file.

/** A copy of the migrations folder holding `0000` to `0002` only: the schema before LOST-02. */
function migrationsUpTo0002(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'migrations-0002-'));
  mkdirSync(path.join(folder, 'meta'));
  const real = journal(MIGRATIONS);
  const kept = real.entries.filter((entry) => /^000[012]_/.test(entry.tag));
  expect(kept.map((entry) => entry.idx)).toEqual([0, 1, 2]);
  for (const entry of kept) {
    copyFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
  }
  writeFileSync(
    path.join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...real, entries: kept }, null, 2),
  );
  return folder;
}

/** A fresh database in the PostgreSQL 15 container, migrated up to `0002` only, and dropped afterwards. */
async function databaseAt0002(
  use: (uri: string, client: pg.Client) => Promise<void>,
): Promise<void> {
  const name = `lost02_${syntheticUuid().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: databaseUrl() });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const uri = withDatabase(databaseUrl(), name);
  const folder = migrationsUpTo0002();
  const client = new pg.Client({ connectionString: uri });
  try {
    const pool = createPool(uri, 1);
    try {
      await migrate(createDatabase(pool), { migrationsFolder: folder });
    } finally {
      await pool.end();
    }
    await client.connect();
    await use(uri, client);
  } finally {
    await client.end().catch(() => undefined);
    rmSync(folder, { recursive: true, force: true });
    await admin.query(`drop database if exists ${name}`);
    await admin.end();
  }
}

/** A journey in `state`, with two responders, a heartbeat with a position and one without. */
async function journeyIn(client: pg.Client, state: string): Promise<void> {
  const { userId, deviceId } = await userWithDevice(client);
  const responderIds = [syntheticUuid(), syntheticUuid()];
  for (const responderId of responderIds) {
    await client.query('insert into users (id) values ($1)', [responderId]);
  }
  const journeyId = syntheticUuid();
  await client.query(
    `insert into journeys (id, walker_id, device_id, state, started_at, last_heartbeat_at)
     values ($1, $2, $3, $4, now() - interval '20 minutes', now() - interval '7 minutes')`,
    [journeyId, userId, deviceId, state],
  );
  for (const responderId of responderIds) {
    await client.query(
      'insert into journey_responders (journey_id, responder_id) values ($1, $2)',
      [journeyId, responderId],
    );
  }
  const position = syntheticPosition();
  const withPosition = await client.query<{ id: string }>(
    `insert into heartbeats (journey_id, event_id, received_at, battery_level)
     values ($1, $2, now() - interval '8 minutes', $3) returning id::text as id`,
    [journeyId, syntheticEventId(), syntheticBatteryLevel()],
  );
  await client.query(
    `insert into positions (heartbeat_id, latitude, longitude, accuracy_m, recorded_at)
     values ($1, $2, $3, $4, $5)`,
    [
      withPosition.rows[0]?.id,
      position.latitude,
      position.longitude,
      position.accuracyMeters,
      position.recordedAt,
    ],
  );
  await client.query(
    `insert into heartbeats (journey_id, event_id, received_at, battery_level)
     values ($1, $2, now() - interval '7 minutes', null)`,
    [journeyId, syntheticEventId()],
  );
}

/** Every row of every table 0003 could touch, as text, in a fixed order. */
async function rowsBefore0003(client: pg.Client) {
  const rows = async (table: string, order: string) =>
    (
      await client.query<{ value: string }>(
        `select row_to_json(t)::text as value from ${table} t order by ${order}`,
      )
    ).rows.map((row) => row.value);
  return {
    users: await rows('users', 't.id'),
    devices: await rows('devices', 't.id'),
    journeys: await rows('journeys', 't.id'),
    responders: await rows('journey_responders', 't.journey_id, t.responder_id'),
    heartbeats: await rows('heartbeats', 't.id'),
    positions: await rows('positions', 't.heartbeat_id'),
    workerHeartbeat: await rows('worker_heartbeat', 't.id'),
  };
}

describe('LOST-02: the alerts migration changes no row that is already there', () => {
  test('LOST-02-AC23: a PostgreSQL 15 database at 0002, holding journeys in every state with heartbeats and positions, migrates through 0003 as the pre-run hook runs it; every existing row is unchanged, and alerts and outbox exist and are empty', async () => {
    await databaseAt0002(async (uri, client) => {
      const states = (
        await client.query<{ state: string }>(
          'select unnest(enum_range(null::journey_state))::text as state',
        )
      ).rows.map((row) => row.state);
      expect(states).toEqual(['ACTIVE', 'LOST_CONTACT', 'ENDED']);
      for (const state of states) {
        await journeyIn(client, state);
      }
      await client.query(
        "insert into worker_heartbeat (id, beat_at) values ('worker', now() - interval '1 minute')",
      );
      const before = await rowsBefore0003(client);
      expect(before.journeys).toHaveLength(states.length);
      expect(before.positions).toHaveLength(states.length);

      await expect(migrateDatabase(uri)).resolves.toBeUndefined();

      const tables = (
        await client.query<{ name: string }>(
          "select table_name as name from information_schema.tables where table_schema = 'public'",
        )
      ).rows.map((row) => row.name);
      expect(tables).toEqual(expect.arrayContaining(['alerts', 'outbox']));
      expect(await rowsBefore0003(client)).toEqual(before);
      const counts = await client.query<{ alerts: number; outbox: number }>(
        'select (select count(*)::int from alerts) as alerts, (select count(*)::int from outbox) as outbox',
      );
      expect(counts.rows).toEqual([{ alerts: 0, outbox: 0 }]);
      const applied = await client.query<{ n: number }>(
        'select count(*)::int as n from drizzle.__drizzle_migrations',
      );
      expect(applied.rows).toEqual([{ n: journal(MIGRATIONS).entries.length }]);
    });
  }, 120_000);

  test('LOST-02-AC23: there is exactly one committed 0003 migration, it is in the journal, and it holds no update, delete or truncate', () => {
    const files = readdirSync(MIGRATIONS).filter((file) => /^0003_.*\.sql$/.test(file));
    expect(files, 'exactly one 0003 migration').toHaveLength(1);
    expect(journal(MIGRATIONS).entries.map((entry) => `${entry.tag}.sql`)).toContain(files[0]);
    const text = readFileSync(path.join(MIGRATIONS, files[0] ?? ''), 'utf8');

    expect(text).toMatch(/\bcreate table\s+("?public"?\.)?"?alerts"?/i);
    expect(text).toMatch(/\bcreate table\s+("?public"?\.)?"?outbox"?/i);
    expect(text).not.toMatch(/\bupdate\s+("?public"?\.)?"?[a-z_]+"?\s+set\b/i);
    expect(text).not.toMatch(/\bdelete\s+from\b/i);
    expect(text).not.toMatch(/\btruncate\b/i);
  });
});
