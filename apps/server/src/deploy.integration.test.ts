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

/** The journal's entries `0000` to `0003`: the schema LOST-02 left. */
function entriesThrough0003(): JournalEntry[] {
  const kept = journal(MIGRATIONS).entries.filter((entry) => /^000[0-3]_/.test(entry.tag));
  expect(kept.map((entry) => entry.idx)).toEqual([0, 1, 2, 3]);
  return kept;
}

/** A copy of the migrations folder holding `0000` to `0003` only: the schema before LOST-03. */
function migrationsUpTo0003(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'migrations-0003-'));
  mkdirSync(path.join(folder, 'meta'));
  const kept = entriesThrough0003();
  for (const entry of kept) {
    copyFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
  }
  writeFileSync(
    path.join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal(MIGRATIONS), entries: kept }, null, 2),
  );
  return folder;
}

/** Drizzle's migrate on one connection, as migrateDatabase runs it, over the migrations up to `0003` only. */
async function migrateThrough0003(uri: string): Promise<void> {
  const folder = migrationsUpTo0003();
  const pool = createPool(uri, 1);
  try {
    await migrate(createDatabase(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
    rmSync(folder, { recursive: true, force: true });
  }
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

      // RG-03 (LOST-03, the spec's "Existing assertions that change by
      // design"): this ran every migration (migrateDatabase), so it would now
      // run 0004 too, and row_to_json of each journey would then hold
      // ended_at and end_reason, both null: the comparison below would fail
      // though no row changed. It keeps its point by migrating through 0003
      // only, with drizzle's migrate on one connection, as migrateDatabase
      // runs it, over a copy of the folder up to 0003 (as migrationsUpTo0002
      // does for 0002). The applied count is the journal's entries up to
      // 0003. LOST-03-AC20's test below takes a database at 0003 through 0004.
      await expect(migrateThrough0003(uri)).resolves.toBeUndefined();

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
      expect(applied.rows).toEqual([{ n: entriesThrough0003().length }]);
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

// LOST-03's migration, 0004, adds an alert's resolution, a journey's end and
// a message's withdrawal, and two message kinds. Like 0003 it has nothing to
// guess, so it must run over a database that already holds journeys, alerts
// and messages in every state, and change none of those rows. It adds enum
// values inside drizzle's one transaction, which PostgreSQL accepts only if
// the transaction does not use them (approach item 6): staging's
// PostgreSQL 15 is the evidence, here and in the empty database above.

/** A fresh database in the PostgreSQL 15 container, migrated up to `0003` only, and dropped afterwards. */
async function databaseAt0003(
  use: (uri: string, client: pg.Client) => Promise<void>,
): Promise<void> {
  const name = `lost03_${syntheticUuid().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: databaseUrl() });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const uri = withDatabase(databaseUrl(), name);
  const client = new pg.Client({ connectionString: uri });
  try {
    await migrateThrough0003(uri);
    await client.connect();
    await use(uri, client);
  } finally {
    await client.end().catch(() => undefined);
    await admin.query(`drop database if exists ${name}`);
    await admin.end();
  }
}

/**
 * A LOST_CONTACT journey with two responders, and its alert in `alertState`
 * with two lost-contact messages: one sent after a failure, one unsent and
 * due again in 30 s after two failures.
 */
async function journeyWithAlert(client: pg.Client, alertState: string): Promise<void> {
  const { userId, deviceId } = await userWithDevice(client);
  const responderIds = [syntheticUuid(), syntheticUuid()];
  for (const responderId of responderIds) {
    await client.query('insert into users (id) values ($1)', [responderId]);
  }
  const journeyId = syntheticUuid();
  await client.query(
    `insert into journeys (id, walker_id, device_id, state, started_at, last_heartbeat_at)
     values ($1, $2, $3, 'LOST_CONTACT', now() - interval '30 minutes', now() - interval '12 minutes')`,
    [journeyId, userId, deviceId],
  );
  for (const responderId of responderIds) {
    await client.query(
      'insert into journey_responders (journey_id, responder_id) values ($1, $2)',
      [journeyId, responderId],
    );
  }
  const alertId = syntheticUuid();
  await client.query(
    `insert into alerts (id, journey_id, state, opened_at, silent_since)
     values ($1, $2, $3, now() - interval '7 minutes', now() - interval '12 minutes')`,
    [alertId, journeyId, alertState],
  );
  await client.query(
    `insert into outbox (id, alert_id, recipient_id, kind, created_at, attempts,
                         next_attempt_at, sent_at, last_failure)
     values ($1, $2, $3, 'LOST_CONTACT', now() - interval '7 minutes', 2,
             now() - interval '6 minutes', now() - interval '6 minutes', 'UNAVAILABLE')`,
    [syntheticUuid(), alertId, responderIds[0]],
  );
  await client.query(
    `insert into outbox (id, alert_id, recipient_id, kind, created_at, attempts,
                         next_attempt_at, sent_at, last_failure)
     values ($1, $2, $3, 'LOST_CONTACT', now() - interval '7 minutes', 2,
             now() + interval '30 seconds', null, 'REFUSED')`,
    [syntheticUuid(), alertId, responderIds[1]],
  );
}

/** The journal's entries `0000` to `0004`: the schema LOST-03 left (LOST-06). */
function entriesThrough0004(): JournalEntry[] {
  const kept = journal(MIGRATIONS).entries.filter((entry) => /^000[0-4]_/.test(entry.tag));
  expect(kept.map((entry) => entry.idx)).toEqual([0, 1, 2, 3, 4]);
  return kept;
}

/** A copy of the migrations folder holding `0000` to `0004` only: the schema before LOST-06. */
function migrationsUpTo0004(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'migrations-0004-'));
  mkdirSync(path.join(folder, 'meta'));
  const kept = entriesThrough0004();
  for (const entry of kept) {
    copyFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
  }
  writeFileSync(
    path.join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal(MIGRATIONS), entries: kept }, null, 2),
  );
  return folder;
}

/** Drizzle's migrate on one connection, as migrateDatabase runs it, over the migrations up to `0004` only. */
async function migrateThrough0004(uri: string): Promise<void> {
  const folder = migrationsUpTo0004();
  const pool = createPool(uri, 1);
  try {
    await migrate(createDatabase(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Every row of every table 0004 could touch, as objects, in a fixed order. */
async function rowsBefore0004(client: pg.Client) {
  const rows = async (table: string, order: string) =>
    (
      await client.query<{ value: Record<string, unknown> }>(
        `select row_to_json(t) as value from ${table} t order by ${order}`,
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
    alerts: await rows('alerts', 't.id'),
    outbox: await rows('outbox', 't.id'),
  };
}

/** An enum's labels, in the database's order (pg_enum). */
async function labelsIn(client: pg.Client, typeName: string): Promise<string[]> {
  const labels = await client.query<{ label: string }>(
    `select e.enumlabel as label from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = $1 order by e.enumsortorder`,
    [typeName],
  );
  return labels.rows.map(({ label }) => label);
}

describe('LOST-03 and SM-04: the resolution migration changes no row that is already there', () => {
  test('LOST-03-AC20: a PostgreSQL 15 database at 0003, holding journeys in every state, alerts in every state and outbox messages sent and unsent, migrates through 0004 as the pre-run hook runs it; every existing row is unchanged, and every new column is null on them', async () => {
    await databaseAt0003(async (uri, client) => {
      const journeyStates = (
        await client.query<{ state: string }>(
          'select unnest(enum_range(null::journey_state))::text as state',
        )
      ).rows.map((row) => row.state);
      const alertStates = (
        await client.query<{ state: string }>(
          'select unnest(enum_range(null::alert_state))::text as state',
        )
      ).rows.map((row) => row.state);
      expect(journeyStates).toEqual(['ACTIVE', 'LOST_CONTACT', 'ENDED']);
      expect(alertStates).toEqual(['OPEN', 'ESCALATED', 'ACKNOWLEDGED', 'RESOLVED']);
      for (const state of journeyStates) {
        await journeyIn(client, state);
      }
      for (const state of alertStates) {
        await journeyWithAlert(client, state);
      }
      await client.query(
        "insert into worker_heartbeat (id, beat_at) values ('worker', now() - interval '1 minute')",
      );
      const before = await rowsBefore0004(client);
      expect(before.journeys).toHaveLength(journeyStates.length + alertStates.length);
      expect(before.alerts).toHaveLength(alertStates.length);
      expect(before.outbox).toHaveLength(2 * alertStates.length);
      expect(before.outbox.filter((row) => row['sent_at'] === null)).toHaveLength(
        alertStates.length,
      );

      // RG-03 (LOST-06, the spec's "Existing assertions that change by
      // design"): this ran every migration (migrateDatabase), so it would now
      // run 0005 too, and each alert row would then hold acknowledged_by and
      // acknowledged_at, both null, and message_kind a fourth label: the
      // comparisons below would fail though 0004 changed nothing. It keeps
      // its point by migrating through 0004 only, with drizzle's migrate on
      // one connection, as migrateDatabase runs it, over a copy of the folder
      // up to 0004 (as migrationsUpTo0003 does for LOST-02-AC23). The applied
      // count is that copy's journal's. LOST-06-AC17's test below takes a
      // database at 0004 through 0005.
      await expect(migrateThrough0004(uri)).resolves.toBeUndefined();

      // Every row as it was, column for column, with the new columns, and
      // only those, beside it, null (approach item 6).
      expect(await rowsBefore0004(client)).toEqual({
        ...before,
        journeys: before.journeys.map((row) => ({ ...row, ended_at: null, end_reason: null })),
        alerts: before.alerts.map((row) => ({ ...row, resolved_at: null, resolution: null })),
        outbox: before.outbox.map((row) => ({ ...row, withdrawn_at: null })),
      });
      expect(await labelsIn(client, 'message_kind')).toEqual([
        'LOST_CONTACT',
        'BACK_IN_CONTACT',
        'HOME',
      ]);
      expect(await labelsIn(client, 'alert_resolution')).toEqual(['BACK_IN_CONTACT', 'HOME']);
      expect(await labelsIn(client, 'journey_end_reason')).toEqual(['HOME']);
      const applied = await client.query<{ n: number }>(
        'select count(*)::int as n from drizzle.__drizzle_migrations',
      );
      // RG-03 (LOST-06): the copy's journal, 0000 to 0004, as above.
      expect(applied.rows).toEqual([{ n: entriesThrough0004().length }]);

      // The values added inside the migration's transaction are usable once
      // it has committed.
      const [message] = before.outbox;
      await expect(
        client.query(
          `insert into outbox (id, alert_id, recipient_id, kind, created_at, attempts,
                               next_attempt_at, sent_at, last_failure)
           values ($1, $2, $3, 'BACK_IN_CONTACT', now(), 0, now(), null, null)`,
          [syntheticUuid(), message?.['alert_id'], message?.['recipient_id']],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
    });
  }, 120_000);

  test('LOST-03-AC20: there is exactly one committed 0004 migration, it is in the journal, it holds no update, delete or truncate, and it names neither new message_kind value but in its add value statements and the new enums’ own definitions', () => {
    const files = readdirSync(MIGRATIONS).filter((file) => /^0004_.*\.sql$/.test(file));
    expect(files, 'exactly one 0004 migration').toHaveLength(1);
    expect(journal(MIGRATIONS).entries.map((entry) => `${entry.tag}.sql`)).toContain(files[0]);
    const text = readFileSync(path.join(MIGRATIONS, files[0] ?? ''), 'utf8');
    const statements = text
      .split(/--> statement-breakpoint|;/)
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '');

    expect(text).not.toMatch(/\bupdate\s+("?public"?\.)?"?[a-z_]+"?\s+set\b/i);
    expect(text).not.toMatch(/\bdelete\s+from\b/i);
    expect(text).not.toMatch(/\btruncate\b/i);

    const addsValue = statements.filter((statement) =>
      /^alter type\s+("?public"?\.)?"?message_kind"?\s+add value\b/i.test(statement),
    );
    expect(addsValue).toHaveLength(2);
    expect(addsValue.join('\n')).toMatch(/'BACK_IN_CONTACT'/);
    expect(addsValue.join('\n')).toMatch(/'HOME'/);
    // alert_resolution and journey_end_reason are new types whose own values
    // carry the same names (approach item 6); their definitions name them,
    // and use nothing of message_kind.
    const definesNewEnum = (statement: string) =>
      /^create type\s+("?public"?\.)?"?(alert_resolution|journey_end_reason)"?\s+as enum\s*\(/i.test(
        statement,
      );
    const naming = statements.filter(
      (statement) => /'(BACK_IN_CONTACT|HOME)'/.test(statement) && !addsValue.includes(statement),
    );
    expect(naming.filter((statement) => !definesNewEnum(statement))).toEqual([]);
  });
});

// LOST-06's migration, 0005, adds who is on an alert and since when, and the
// notice's message kind. Like 0004 it has nothing to guess, so it must run over
// a database that already holds journeys, alerts and messages in every state,
// and change none of those rows. It adds an enum value inside drizzle's one
// transaction, which PostgreSQL accepts only if the transaction does not use
// it (approach item 7): staging's PostgreSQL 15 is the evidence.

/** A fresh database in the PostgreSQL 15 container, migrated up to `0004` only, and dropped afterwards. */
async function databaseAt0004(
  use: (uri: string, client: pg.Client) => Promise<void>,
): Promise<void> {
  const name = `lost06_${syntheticUuid().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: databaseUrl() });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const uri = withDatabase(databaseUrl(), name);
  const client = new pg.Client({ connectionString: uri });
  try {
    await migrateThrough0004(uri);
    await client.connect();
    await use(uri, client);
  } finally {
    await client.end().catch(() => undefined);
    await admin.query(`drop database if exists ${name}`);
    await admin.end();
  }
}

/** The journal's entries `0000` to `0005`: the schema LOST-06 left (LOST-07). */
function entriesThrough0005(): JournalEntry[] {
  const kept = journal(MIGRATIONS).entries.filter((entry) => /^000[0-5]_/.test(entry.tag));
  expect(kept.map((entry) => entry.idx)).toEqual([0, 1, 2, 3, 4, 5]);
  return kept;
}

/** A copy of the migrations folder holding `0000` to `0005` only: the schema before LOST-07. */
function migrationsUpTo0005(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'migrations-0005-'));
  mkdirSync(path.join(folder, 'meta'));
  const kept = entriesThrough0005();
  for (const entry of kept) {
    copyFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
  }
  writeFileSync(
    path.join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal(MIGRATIONS), entries: kept }, null, 2),
  );
  return folder;
}

/** Drizzle's migrate on one connection, as migrateDatabase runs it, over the migrations up to `0005` only. */
async function migrateThrough0005(uri: string): Promise<void> {
  const folder = migrationsUpTo0005();
  const pool = createPool(uri, 1);
  try {
    await migrate(createDatabase(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
    rmSync(folder, { recursive: true, force: true });
  }
}

/** A fresh database in the PostgreSQL 15 container, migrated up to `0005` only, and dropped afterwards (LOST-07). */
async function databaseAt0005(
  use: (uri: string, client: pg.Client) => Promise<void>,
): Promise<void> {
  const name = `lost07_${syntheticUuid().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: databaseUrl() });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const uri = withDatabase(databaseUrl(), name);
  const client = new pg.Client({ connectionString: uri });
  try {
    await migrateThrough0005(uri);
    await client.connect();
    await use(uri, client);
  } finally {
    await client.end().catch(() => undefined);
    await admin.query(`drop database if exists ${name}`);
    await admin.end();
  }
}

describe('LOST-06: the acknowledgement migration changes no row that is already there', () => {
  test('LOST-06-AC17: a PostgreSQL 15 database at 0004, holding journeys in every state, alerts in every state with and without a resolution, and outbox messages sent, unsent and withdrawn, migrates through 0005 as the pre-run hook runs it; every existing row is unchanged, both new columns are null on them, and ACKNOWLEDGED can be used once the migration has committed', async () => {
    await databaseAt0004(async (uri, client) => {
      const journeyStates = (
        await client.query<{ state: string }>(
          'select unnest(enum_range(null::journey_state))::text as state',
        )
      ).rows.map((row) => row.state);
      const alertStates = (
        await client.query<{ state: string }>(
          'select unnest(enum_range(null::alert_state))::text as state',
        )
      ).rows.map((row) => row.state);
      expect(journeyStates).toEqual(['ACTIVE', 'LOST_CONTACT', 'ENDED']);
      expect(alertStates).toEqual(['OPEN', 'ESCALATED', 'ACKNOWLEDGED', 'RESOLVED']);
      for (const state of journeyStates) {
        await journeyIn(client, state);
      }
      for (const state of alertStates) {
        await journeyWithAlert(client, state);
      }
      // A resolution on the RESOLVED one, a stand-down beside it, and one
      // unsent message withdrawn: the columns 0004 added, in use.
      await client.query(
        `update alerts set resolved_at = now() - interval '1 minute', resolution = 'HOME'
          where state = 'RESOLVED'`,
      );
      const resolved = await client.query<{ alert_id: string; recipient_id: string }>(
        `select o.alert_id::text as alert_id, o.recipient_id::text as recipient_id
           from outbox o join alerts a on a.id = o.alert_id
          where a.state = 'RESOLVED' and o.sent_at is null`,
      );
      const [unsent] = resolved.rows;
      await client.query(
        "update outbox set withdrawn_at = now() - interval '1 minute' where alert_id = $1 and sent_at is null",
        [unsent?.alert_id],
      );
      await client.query(
        `insert into outbox (id, alert_id, recipient_id, kind, created_at, attempts,
                             next_attempt_at, sent_at, last_failure)
         values ($1, $2, $3, 'HOME', now(), 0, now(), null, null)`,
        [syntheticUuid(), unsent?.alert_id, unsent?.recipient_id],
      );
      await client.query(
        "insert into worker_heartbeat (id, beat_at) values ('worker', now() - interval '1 minute')",
      );
      const before = await rowsBefore0004(client);
      expect(before.alerts).toHaveLength(alertStates.length);
      expect(before.alerts.filter((row) => row['resolution'] !== null)).toHaveLength(1);
      expect(before.outbox.filter((row) => row['withdrawn_at'] !== null)).toHaveLength(1);
      expect(before.outbox.filter((row) => row['sent_at'] === null)).toHaveLength(
        alertStates.length + 1,
      );

      // RG-03 (LOST-07, the spec's "Existing assertions that change by
      // design"): this ran every migration (migrateDatabase), so it would now
      // run 0006 too, and each alert row would then hold sms_raised_at, null,
      // and message_kind a fifth label: the comparisons below would fail
      // though 0005 changed nothing. It keeps its point by migrating through
      // 0005 only, with drizzle's migrate on one connection, as
      // migrateDatabase runs it, over a copy of the folder up to 0005 (as
      // migrationsUpTo0004 does for LOST-03-AC20). The applied count is that
      // copy's journal's. LOST-07-AC19's test below takes a database at 0005
      // through 0006.
      await expect(migrateThrough0005(uri)).resolves.toBeUndefined();

      // Every row as it was, column for column, with the two new columns,
      // and only those, beside each alert, null (approach item 7).
      expect(await rowsBefore0004(client)).toEqual({
        ...before,
        alerts: before.alerts.map((row) => ({
          ...row,
          acknowledged_by: null,
          acknowledged_at: null,
        })),
      });
      expect(await labelsIn(client, 'message_kind')).toEqual([
        'LOST_CONTACT',
        'BACK_IN_CONTACT',
        'HOME',
        'ACKNOWLEDGED',
      ]);
      const applied = await client.query<{ n: number }>(
        'select count(*)::int as n from drizzle.__drizzle_migrations',
      );
      // RG-03 (LOST-07): the copy's journal, 0000 to 0005, as above.
      expect(applied.rows).toEqual([{ n: entriesThrough0005().length }]);

      // The value added inside the migration's transaction is usable once it
      // has committed, and so are the two columns, together.
      const [message] = before.outbox;
      await expect(
        client.query(
          `insert into outbox (id, alert_id, recipient_id, kind, created_at, attempts,
                               next_attempt_at, sent_at, last_failure)
           values ($1, $2, $3, 'ACKNOWLEDGED', now(), 0, now(), null, null)`,
          [syntheticUuid(), message?.['alert_id'], message?.['recipient_id']],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        client.query(
          `update alerts set state = 'ACKNOWLEDGED', acknowledged_by = $2, acknowledged_at = now()
            where id = $1`,
          [message?.['alert_id'], message?.['recipient_id']],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
    });
  }, 120_000);

  test('LOST-06-AC17: there is exactly one committed 0005 migration, it is in the journal, it holds no update, delete or truncate, and it names ACKNOWLEDGED only in message_kind’s add value statement', () => {
    const files = readdirSync(MIGRATIONS).filter((file) => /^0005_.*\.sql$/.test(file));
    expect(files, 'exactly one 0005 migration').toHaveLength(1);
    expect(journal(MIGRATIONS).entries.map((entry) => `${entry.tag}.sql`)).toContain(files[0]);
    const text = readFileSync(path.join(MIGRATIONS, files[0] ?? ''), 'utf8');
    const statements = text
      .split(/--> statement-breakpoint|;/)
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '');

    expect(text).not.toMatch(/\bupdate\s+("?public"?\.)?"?[a-z_]+"?\s+set\b/i);
    expect(text).not.toMatch(/\bdelete\s+from\b/i);
    expect(text).not.toMatch(/\btruncate\b/i);
    const addsValue = statements.filter((statement) =>
      /^alter type\s+("?public"?\.)?"?message_kind"?\s+add value\b/i.test(statement),
    );
    expect(addsValue).toHaveLength(1);
    expect(addsValue[0]).toMatch(/'ACKNOWLEDGED'/);
    // ACKNOWLEDGED is an alert_state label too, since 0003; 0005 names it
    // nowhere else, so nothing in its transaction uses the new value.
    expect(
      statements.filter(
        (statement) => statement.includes("'ACKNOWLEDGED'") && !addsValue.includes(statement),
      ),
    ).toEqual([]);
    expect(text).toContain('acknowledged_by');
    expect(text).toContain('acknowledged_at');
  });
});

/** The journal's entries `0000` to `0006`: the schema LOST-07 left (SM-10). */
function entriesThrough0006(): JournalEntry[] {
  const kept = journal(MIGRATIONS).entries.filter((entry) => /^000[0-6]_/.test(entry.tag));
  expect(kept.map((entry) => entry.idx)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  return kept;
}

/** A copy of the migrations folder holding `0000` to `0006` only: the schema before SM-10. */
function migrationsUpTo0006(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'migrations-0006-'));
  mkdirSync(path.join(folder, 'meta'));
  const kept = entriesThrough0006();
  for (const entry of kept) {
    copyFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
  }
  writeFileSync(
    path.join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal(MIGRATIONS), entries: kept }, null, 2),
  );
  return folder;
}

/** Drizzle's migrate on one connection, as migrateDatabase runs it, over the migrations up to `0006` only. */
async function migrateThrough0006(uri: string): Promise<void> {
  const folder = migrationsUpTo0006();
  const pool = createPool(uri, 1);
  try {
    await migrate(createDatabase(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
    rmSync(folder, { recursive: true, force: true });
  }
}

/** A fresh database in the PostgreSQL 15 container, migrated up to `0006` only, and dropped afterwards (SM-10). */
async function databaseAt0006(
  use: (uri: string, client: pg.Client) => Promise<void>,
): Promise<void> {
  const name = `sm10_${syntheticUuid().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: databaseUrl() });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const uri = withDatabase(databaseUrl(), name);
  const client = new pg.Client({ connectionString: uri });
  try {
    await migrateThrough0006(uri);
    await client.connect();
    await use(uri, client);
  } finally {
    await client.end().catch(() => undefined);
    await admin.query(`drop database if exists ${name}`);
    await admin.end();
  }
}

// LOST-07's migration, 0006, adds when an alert was escalated, and the SMS's
// message kind. Like 0005 it has nothing to guess, so it must run over a
// database that already holds journeys, alerts and messages in every state,
// and change none of those rows. It adds an enum value inside drizzle's one
// transaction, which PostgreSQL accepts only if the transaction does not use
// it (approach item 9): staging's PostgreSQL 15 is the evidence.

describe('LOST-07: the escalation migration changes no row that is already there', () => {
  test('LOST-07-AC19: a PostgreSQL 15 database at 0005, holding journeys in every state, alerts in every state with and without a resolution and an acknowledgement, and outbox messages of every kind, sent, unsent and withdrawn, migrates through 0006 as the pre-run hook runs it; every existing row is unchanged, sms_raised_at is null on them, and LOST_CONTACT_SMS can be used once the migration has committed', async () => {
    await databaseAt0005(async (uri, client) => {
      const journeyStates = (
        await client.query<{ state: string }>(
          'select unnest(enum_range(null::journey_state))::text as state',
        )
      ).rows.map((row) => row.state);
      const alertStates = (
        await client.query<{ state: string }>(
          'select unnest(enum_range(null::alert_state))::text as state',
        )
      ).rows.map((row) => row.state);
      expect(journeyStates).toEqual(['ACTIVE', 'LOST_CONTACT', 'ENDED']);
      expect(alertStates).toEqual(['OPEN', 'ESCALATED', 'ACKNOWLEDGED', 'RESOLVED']);
      for (const state of journeyStates) {
        await journeyIn(client, state);
      }
      for (const state of alertStates) {
        await journeyWithAlert(client, state);
      }
      // A resolution on the RESOLVED alert, and an acknowledgement on it and
      // on the ACKNOWLEDGED one: the columns 0004 and 0005 added, in use.
      await client.query(
        `update alerts set resolved_at = now() - interval '1 minute', resolution = 'HOME'
          where state = 'RESOLVED'`,
      );
      await client.query(
        `update alerts a
            set acknowledged_at = now() - interval '3 minutes',
                acknowledged_by = (select r.responder_id from journey_responders r
                                    where r.journey_id = a.journey_id
                                    order by r.responder_id limit 1)
          where a.state in ('ACKNOWLEDGED', 'RESOLVED')`,
      );
      // Every kind 0005 knows beside the RESOLVED alert's lost-contact pushes:
      // a stand-down sent, another unsent, a notice withdrawn; and its unsent
      // lost-contact push withdrawn.
      const resolved = await client.query<{ alert_id: string; recipient_id: string }>(
        `select o.alert_id::text as alert_id, o.recipient_id::text as recipient_id
           from outbox o join alerts a on a.id = o.alert_id
          where a.state = 'RESOLVED' order by o.recipient_id`,
      );
      const [first, second] = resolved.rows;
      await client.query(
        "update outbox set withdrawn_at = now() - interval '1 minute' where alert_id = $1 and sent_at is null",
        [first?.alert_id],
      );
      for (const [recipient, kind, sent, withdrawn] of [
        [first, 'BACK_IN_CONTACT', true, false],
        [second, 'HOME', false, false],
        [second, 'ACKNOWLEDGED', false, true],
      ] as const) {
        await client.query(
          `insert into outbox (id, alert_id, recipient_id, kind, created_at, attempts,
                               next_attempt_at, sent_at, last_failure, withdrawn_at)
           values ($1, $2, $3, $4, now() - interval '2 minutes', 1, now() - interval '1 minute',
                   case when $5::boolean then now() - interval '1 minute' end, null,
                   case when $6::boolean then now() - interval '30 seconds' end)`,
          [syntheticUuid(), recipient?.alert_id, recipient?.recipient_id, kind, sent, withdrawn],
        );
      }
      await client.query(
        "insert into worker_heartbeat (id, beat_at) values ('worker', now() - interval '1 minute')",
      );
      const before = await rowsBefore0004(client);
      expect(before.alerts).toHaveLength(alertStates.length);
      expect(before.alerts.filter((row) => row['resolution'] !== null)).toHaveLength(1);
      expect(before.alerts.filter((row) => row['acknowledged_by'] !== null)).toHaveLength(2);
      expect(new Set(before.outbox.map((row) => row['kind']))).toEqual(
        new Set(['LOST_CONTACT', 'BACK_IN_CONTACT', 'HOME', 'ACKNOWLEDGED']),
      );
      expect(before.outbox.filter((row) => row['sent_at'] !== null).length).toBeGreaterThan(0);
      expect(
        before.outbox.filter((row) => row['sent_at'] === null && row['withdrawn_at'] === null)
          .length,
      ).toBeGreaterThan(0);
      expect(before.outbox.filter((row) => row['withdrawn_at'] !== null)).toHaveLength(2);

      // RG-03 (SM-10, named in the spec's "Existing assertions that change by
      // design"): this ran every migration (migrateDatabase), so it would now
      // run 0007 too, and each alert and message row would then hold round,
      // 1, and each message journey_id, null, and message_kind a sixth label:
      // the comparisons below would fail though 0006 changed nothing. It
      // keeps its point by migrating through 0006 only, with drizzle's
      // migrate on one connection, as migrateDatabase runs it, over a copy of
      // the folder up to 0006 (as migrationsUpTo0005 does for LOST-06-AC17).
      // The applied count is that copy's journal's. SM-10-AC21's test below
      // takes a database at 0006 through 0007.
      await expect(migrateThrough0006(uri)).resolves.toBeUndefined();

      // Every row as it was, column for column, with the one new column, and
      // only that, beside each alert, null (approach item 9).
      expect(await rowsBefore0004(client)).toEqual({
        ...before,
        alerts: before.alerts.map((row) => ({ ...row, sms_raised_at: null })),
      });
      expect(await labelsIn(client, 'message_kind')).toEqual([
        'LOST_CONTACT',
        'BACK_IN_CONTACT',
        'HOME',
        'ACKNOWLEDGED',
        'LOST_CONTACT_SMS',
      ]);
      const applied = await client.query<{ n: number }>(
        'select count(*)::int as n from drizzle.__drizzle_migrations',
      );
      // RG-03 (SM-10): the copy's journal, 0000 to 0006, as above.
      expect(applied.rows).toEqual([{ n: entriesThrough0006().length }]);

      // The value added inside the migration's transaction is usable once it
      // has committed, and so is the new column.
      const [message] = before.outbox;
      await expect(
        client.query(
          `insert into outbox (id, alert_id, recipient_id, kind, created_at, attempts,
                               next_attempt_at, sent_at, last_failure)
           values ($1, $2, $3, 'LOST_CONTACT_SMS', now(), 0, now(), null, null)`,
          [syntheticUuid(), message?.['alert_id'], message?.['recipient_id']],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        client.query("update alerts set state = 'ESCALATED', sms_raised_at = now() where id = $1", [
          message?.['alert_id'],
        ]),
      ).resolves.toMatchObject({ rowCount: 1 });
    });
  }, 120_000);

  test('LOST-07-AC19: there is exactly one committed 0006 migration, it is in the journal, it holds no update, delete or truncate, and it names LOST_CONTACT_SMS only in message_kind’s add value statement', () => {
    const files = readdirSync(MIGRATIONS).filter((file) => /^0006_.*\.sql$/.test(file));
    expect(files, 'exactly one 0006 migration').toHaveLength(1);
    expect(journal(MIGRATIONS).entries.map((entry) => `${entry.tag}.sql`)).toContain(files[0]);
    const text = readFileSync(path.join(MIGRATIONS, files[0] ?? ''), 'utf8');
    const statements = text
      .split(/--> statement-breakpoint|;/)
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '');

    expect(text).not.toMatch(/\bupdate\s+("?public"?\.)?"?[a-z_]+"?\s+set\b/i);
    expect(text).not.toMatch(/\bdelete\s+from\b/i);
    expect(text).not.toMatch(/\btruncate\b/i);
    const addsValue = statements.filter((statement) =>
      /^alter type\s+("?public"?\.)?"?message_kind"?\s+add value\b/i.test(statement),
    );
    expect(addsValue).toHaveLength(1);
    expect(addsValue[0]).toMatch(/'LOST_CONTACT_SMS'/);
    // 0006 names it nowhere else, so nothing in its transaction uses the new
    // value.
    expect(
      statements.filter(
        (statement) => statement.includes('LOST_CONTACT_SMS') && !addsValue.includes(statement),
      ),
    ).toEqual([]);
    expect(text).toContain('sms_raised_at');
  });
});

// SM-10's migration, 0007, adds a round to every alert and message, a journey
// a message may name instead of an alert (the walker's warning), the check
// that holds exactly one of the two, the round in the outbox's unique key, and
// NO_RESPONDER. Like 0004 to 0006 it has nothing to guess, so it must run
// over a database that already holds journeys, alerts and messages in every
// state, and change none of those rows: each reads round 1 and journey_id
// null beside what it held. It adds an enum value inside drizzle's one
// transaction, which PostgreSQL accepts only if the transaction does not use
// it (approach item 9): staging's PostgreSQL 15 is the evidence.

describe('SM-10: the removal migration changes no row that is already there', () => {
  test('SM-10-AC21: a PostgreSQL 15 database at 0006, holding journeys in every state, alerts in every state with and without a resolution, an acknowledgement and an escalation time, and outbox messages of every kind, sent, unsent and withdrawn, migrates through 0007 as the pre-run hook runs it; every existing row is unchanged, column for column, with round 1 and journey_id null beside it; NO_RESPONDER and a journey’s message can be used once the migration has committed', async () => {
    await databaseAt0006(async (uri, client) => {
      const journeyStates = (
        await client.query<{ state: string }>(
          'select unnest(enum_range(null::journey_state))::text as state',
        )
      ).rows.map((row) => row.state);
      const alertStates = (
        await client.query<{ state: string }>(
          'select unnest(enum_range(null::alert_state))::text as state',
        )
      ).rows.map((row) => row.state);
      expect(journeyStates).toEqual(['ACTIVE', 'LOST_CONTACT', 'ENDED']);
      expect(alertStates).toEqual(['OPEN', 'ESCALATED', 'ACKNOWLEDGED', 'RESOLVED']);
      for (const state of journeyStates) {
        await journeyIn(client, state);
      }
      for (const state of alertStates) {
        await journeyWithAlert(client, state);
      }
      // A resolution on the RESOLVED alert, an acknowledgement on it and on
      // the ACKNOWLEDGED one, and an escalation time on the ESCALATED one and
      // the RESOLVED one: the columns 0004 to 0006 added, in use.
      await client.query(
        `update alerts set resolved_at = now() - interval '1 minute', resolution = 'HOME'
          where state = 'RESOLVED'`,
      );
      await client.query(
        `update alerts a
            set acknowledged_at = now() - interval '3 minutes',
                acknowledged_by = (select r.responder_id from journey_responders r
                                    where r.journey_id = a.journey_id
                                    order by r.responder_id limit 1)
          where a.state in ('ACKNOWLEDGED', 'RESOLVED')`,
      );
      await client.query(
        `update alerts set sms_raised_at = now() - interval '4 minutes'
          where state in ('ESCALATED', 'RESOLVED')`,
      );
      // Every kind 0006 knows beside the RESOLVED alert's lost-contact
      // pushes: a stand-down sent, another unsent, a notice withdrawn, and an
      // SMS unsent and failing; and its unsent lost-contact push withdrawn.
      const resolved = await client.query<{ alert_id: string; recipient_id: string }>(
        `select o.alert_id::text as alert_id, o.recipient_id::text as recipient_id
           from outbox o join alerts a on a.id = o.alert_id
          where a.state = 'RESOLVED' order by o.recipient_id`,
      );
      const [first, second] = resolved.rows;
      await client.query(
        "update outbox set withdrawn_at = now() - interval '1 minute' where alert_id = $1 and sent_at is null",
        [first?.alert_id],
      );
      for (const [recipient, kind, sent, withdrawn] of [
        [first, 'BACK_IN_CONTACT', true, false],
        [second, 'HOME', false, false],
        [second, 'ACKNOWLEDGED', false, true],
        [first, 'LOST_CONTACT_SMS', false, false],
      ] as const) {
        await client.query(
          `insert into outbox (id, alert_id, recipient_id, kind, created_at, attempts,
                               next_attempt_at, sent_at, last_failure, withdrawn_at)
           values ($1, $2, $3, $4, now() - interval '2 minutes', 1, now() - interval '1 minute',
                   case when $5::boolean then now() - interval '1 minute' end, null,
                   case when $6::boolean then now() - interval '30 seconds' end)`,
          [syntheticUuid(), recipient?.alert_id, recipient?.recipient_id, kind, sent, withdrawn],
        );
      }
      await client.query(
        "insert into worker_heartbeat (id, beat_at) values ('worker', now() - interval '1 minute')",
      );
      const before = await rowsBefore0004(client);
      expect(before.alerts).toHaveLength(alertStates.length);
      expect(before.alerts.filter((row) => row['resolution'] !== null)).toHaveLength(1);
      expect(before.alerts.filter((row) => row['acknowledged_by'] !== null)).toHaveLength(2);
      expect(before.alerts.filter((row) => row['sms_raised_at'] !== null)).toHaveLength(2);
      expect(new Set(before.outbox.map((row) => row['kind']))).toEqual(
        new Set(['LOST_CONTACT', 'BACK_IN_CONTACT', 'HOME', 'ACKNOWLEDGED', 'LOST_CONTACT_SMS']),
      );
      expect(before.outbox.filter((row) => row['sent_at'] !== null).length).toBeGreaterThan(0);
      expect(
        before.outbox.filter((row) => row['sent_at'] === null && row['withdrawn_at'] === null)
          .length,
      ).toBeGreaterThan(0);
      expect(before.outbox.filter((row) => row['withdrawn_at'] !== null)).toHaveLength(2);

      // RG-03 (LOST-08, named in the spec's "Existing assertions that change
      // by design"): this ran every migration (migrateDatabase), so it would
      // now run 0008 too, and message_kind would then hold eight labels: the
      // comparison below would fail though 0007 changed nothing. It keeps its
      // point by migrating through 0007 only, with drizzle's migrate on one
      // connection, as migrateDatabase runs it, over a copy of the folder up
      // to 0007 (as migrationsUpTo0006 does for LOST-07-AC19). The applied
      // count and the journal pin below are that copy's. LOST-08-AC20's test
      // takes a database at 0007 through 0008.
      await expect(migrateThrough0007(uri)).resolves.toBeUndefined();

      // Every row as it was, column for column, with the new columns, and
      // only those, beside it: round 1 on each alert and message, and
      // journey_id null on each message (approach item 9).
      expect(await rowsBefore0004(client)).toEqual({
        ...before,
        alerts: before.alerts.map((row) => ({ ...row, round: 1 })),
        outbox: before.outbox.map((row) => ({ ...row, round: 1, journey_id: null })),
      });
      expect(await labelsIn(client, 'message_kind')).toEqual([
        'LOST_CONTACT',
        'BACK_IN_CONTACT',
        'HOME',
        'ACKNOWLEDGED',
        'LOST_CONTACT_SMS',
        'NO_RESPONDER',
      ]);
      const applied = await client.query<{ n: number }>(
        'select count(*)::int as n from drizzle.__drizzle_migrations',
      );
      // RG-03 (LOST-08, as above): the copy's journal, 0000 to 0007, both
      // for the applied count and for the indexes, which were the whole
      // journal's and are now its first eight.
      expect(applied.rows).toEqual([{ n: entriesThrough0007().length }]);
      expect(entriesThrough0007().map((entry) => entry.idx)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

      // The value added inside the migration's transaction is usable once it
      // has committed, and so is a journey's message, naming the journey and
      // no alert; and an alert's message in its second round.
      const [journey] = before.journeys;
      await expect(
        client.query(
          `insert into outbox (id, journey_id, recipient_id, kind, created_at, attempts,
                               next_attempt_at)
           values ($1, $2, $3, 'NO_RESPONDER', now(), 0, now())`,
          [syntheticUuid(), journey?.['id'], journey?.['walker_id']],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      const [message] = before.outbox;
      await expect(
        client.query(
          `insert into outbox (id, alert_id, recipient_id, kind, created_at, attempts,
                               next_attempt_at, round)
           values ($1, $2, $3, $4, now(), 0, now(), 2)`,
          [syntheticUuid(), message?.['alert_id'], message?.['recipient_id'], message?.['kind']],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
    });
  }, 120_000);

  test('SM-10-AC21: there is exactly one committed 0007 migration, it is in the journal, it holds no update, delete or truncate, and it names NO_RESPONDER only in message_kind’s add value statement', () => {
    const files = readdirSync(MIGRATIONS).filter((file) => /^0007_.*\.sql$/.test(file));
    expect(files, 'exactly one 0007 migration').toHaveLength(1);
    expect(journal(MIGRATIONS).entries.map((entry) => `${entry.tag}.sql`)).toContain(files[0]);
    const text = readFileSync(path.join(MIGRATIONS, files[0] ?? ''), 'utf8');
    const statements = text
      .split(/--> statement-breakpoint|;/)
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '');

    expect(text).not.toMatch(/\bupdate\s+("?public"?\.)?"?[a-z_]+"?\s+set\b/i);
    expect(text).not.toMatch(/\bdelete\s+from\b/i);
    expect(text).not.toMatch(/\btruncate\b/i);
    const addsValue = statements.filter((statement) =>
      /^alter type\s+("?public"?\.)?"?message_kind"?\s+add value\b/i.test(statement),
    );
    expect(addsValue).toHaveLength(1);
    expect(addsValue[0]).toMatch(/'NO_RESPONDER'/);
    // 0007 names it nowhere else, so nothing in its transaction uses the new
    // value.
    expect(
      statements.filter(
        (statement) => statement.includes('NO_RESPONDER') && !addsValue.includes(statement),
      ),
    ).toEqual([]);
    expect(text).toContain('round');
    expect(text).toContain('journey_id');
    expect(text).toContain('outbox_alert_id_recipient_id_kind_round_unique');
  });
});

/** The journal's entries `0000` to `0007`: the schema SM-10 left (LOST-08). */
function entriesThrough0007(): JournalEntry[] {
  const kept = journal(MIGRATIONS).entries.filter((entry) => /^000[0-7]_/.test(entry.tag));
  expect(kept.map((entry) => entry.idx)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  return kept;
}

/** A copy of the migrations folder holding `0000` to `0007` only: the schema before LOST-08. */
function migrationsUpTo0007(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'migrations-0007-'));
  mkdirSync(path.join(folder, 'meta'));
  const kept = entriesThrough0007();
  for (const entry of kept) {
    copyFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
  }
  writeFileSync(
    path.join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal(MIGRATIONS), entries: kept }, null, 2),
  );
  return folder;
}

/** Drizzle's migrate on one connection, as migrateDatabase runs it, over the migrations up to `0007` only. */
async function migrateThrough0007(uri: string): Promise<void> {
  const folder = migrationsUpTo0007();
  const pool = createPool(uri, 1);
  try {
    await migrate(createDatabase(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
    rmSync(folder, { recursive: true, force: true });
  }
}

/** A fresh database in the PostgreSQL 15 container, migrated up to `0007` only, and dropped afterwards (LOST-08). */
async function databaseAt0007(
  use: (uri: string, client: pg.Client) => Promise<void>,
): Promise<void> {
  const name = `lost08_${syntheticUuid().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: databaseUrl() });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const uri = withDatabase(databaseUrl(), name);
  const client = new pg.Client({ connectionString: uri });
  try {
    await migrateThrough0007(uri);
    await client.connect();
    await use(uri, client);
  } finally {
    await client.end().catch(() => undefined);
    await admin.query(`drop database if exists ${name}`);
    await admin.end();
  }
}

// LOST-08's migration, 0008, adds SAFE and EXPIRED to alert_resolution,
// message_kind and journey_end_reason: the close's and the 24-hour end's
// resolutions, stand-downs and end reasons (D-126). It changes no column,
// check or index, so it must run over a database that already holds
// journeys, alerts and messages in every state and change none of those
// rows. It adds enum values inside drizzle's one transaction, which
// PostgreSQL accepts only if the transaction does not use them (approach item
// 8): staging's PostgreSQL 15 is the evidence.

describe('LOST-08: the close’s and the 24-hour end’s migration changes no row that is already there', () => {
  test('LOST-08-AC20: a PostgreSQL 15 database at 0007, holding journeys in every state and end reason, alerts in every state with and without a resolution, and outbox messages of every kind, sent, unsent and withdrawn, migrates through 0008 as the pre-run hook runs it; every row is unchanged, column for column; the three enums then hold SAFE and EXPIRED last, and both can be used once the migration has committed', async () => {
    await databaseAt0007(async (uri, client) => {
      const journeyStates = (
        await client.query<{ state: string }>(
          'select unnest(enum_range(null::journey_state))::text as state',
        )
      ).rows.map((row) => row.state);
      const alertStates = (
        await client.query<{ state: string }>(
          'select unnest(enum_range(null::alert_state))::text as state',
        )
      ).rows.map((row) => row.state);
      expect(journeyStates).toEqual(['ACTIVE', 'LOST_CONTACT', 'ENDED']);
      expect(alertStates).toEqual(['OPEN', 'ESCALATED', 'ACKNOWLEDGED', 'RESOLVED']);
      expect(await labelsIn(client, 'journey_end_reason')).toEqual(['HOME']);
      expect(await labelsIn(client, 'alert_resolution')).toEqual(['BACK_IN_CONTACT', 'HOME']);
      for (const state of journeyStates) {
        await journeyIn(client, state);
      }
      // The ENDED journey ended "I'm home", with its time: the one end
      // reason 0007 knows, in use.
      await client.query(
        `update journeys set ended_at = now() - interval '1 minute', end_reason = 'HOME'
          where state = 'ENDED'`,
      );
      for (const state of alertStates) {
        await journeyWithAlert(client, state);
      }
      // A second RESOLVED alert, so both resolutions 0007 knows are in use;
      // an acknowledgement, an escalation time and a second round beside
      // them: the columns 0005 to 0007 added, in use.
      await journeyWithAlert(client, 'RESOLVED');
      await client.query(
        `update alerts set resolved_at = now() - interval '1 minute',
                           resolution = case when id = (select id from alerts
                                                          where state = 'RESOLVED'
                                                          order by id limit 1)
                                             then 'HOME'::alert_resolution
                                             else 'BACK_IN_CONTACT'::alert_resolution end
          where state = 'RESOLVED'`,
      );
      await client.query(
        `update alerts a
            set acknowledged_at = now() - interval '3 minutes',
                acknowledged_by = (select r.responder_id from journey_responders r
                                    where r.journey_id = a.journey_id
                                    order by r.responder_id limit 1)
          where a.state in ('ACKNOWLEDGED', 'RESOLVED')`,
      );
      await client.query(
        `update alerts set sms_raised_at = now() - interval '4 minutes', round = 2
          where state = 'ESCALATED'`,
      );
      // Every kind 0007 knows beside the lost-contact pushes: stand-downs,
      // a notice, an SMS, sent, unsent and withdrawn, and the walker's
      // warning, naming the journey and no alert.
      const resolved = await client.query<{ alert_id: string; recipient_id: string }>(
        `select o.alert_id::text as alert_id, o.recipient_id::text as recipient_id
           from outbox o join alerts a on a.id = o.alert_id
          where a.state = 'RESOLVED' order by o.alert_id, o.recipient_id`,
      );
      const [first, second] = resolved.rows;
      await client.query(
        "update outbox set withdrawn_at = now() - interval '1 minute' where alert_id = $1 and sent_at is null",
        [first?.alert_id],
      );
      for (const [recipient, kind, sent, withdrawn] of [
        [first, 'BACK_IN_CONTACT', true, false],
        [second, 'HOME', false, false],
        [second, 'ACKNOWLEDGED', false, true],
        [first, 'LOST_CONTACT_SMS', false, false],
      ] as const) {
        await client.query(
          `insert into outbox (id, alert_id, recipient_id, kind, created_at, attempts,
                               next_attempt_at, sent_at, last_failure, withdrawn_at)
           values ($1, $2, $3, $4, now() - interval '2 minutes', 1, now() - interval '1 minute',
                   case when $5::boolean then now() - interval '1 minute' end, null,
                   case when $6::boolean then now() - interval '30 seconds' end)`,
          [syntheticUuid(), recipient?.alert_id, recipient?.recipient_id, kind, sent, withdrawn],
        );
      }
      const walking = await client.query<{ id: string; walker_id: string }>(
        "select id::text as id, walker_id::text as walker_id from journeys where state = 'ACTIVE' limit 1",
      );
      await client.query(
        `insert into outbox (id, journey_id, recipient_id, kind, created_at, attempts,
                             next_attempt_at)
         values ($1, $2, $3, 'NO_RESPONDER', now() - interval '2 minutes', 0,
                 now() - interval '2 minutes')`,
        [syntheticUuid(), walking.rows[0]?.id, walking.rows[0]?.walker_id],
      );
      await client.query(
        "insert into worker_heartbeat (id, beat_at) values ('worker', now() - interval '1 minute')",
      );
      const before = await rowsBefore0004(client);
      expect(new Set(before.journeys.map((row) => row['state']))).toEqual(new Set(journeyStates));
      expect(before.journeys.filter((row) => row['end_reason'] === 'HOME')).toHaveLength(1);
      expect(new Set(before.alerts.map((row) => row['state']))).toEqual(new Set(alertStates));
      expect(new Set(before.alerts.map((row) => row['resolution']))).toEqual(
        new Set([null, 'BACK_IN_CONTACT', 'HOME']),
      );
      expect(new Set(before.outbox.map((row) => row['kind']))).toEqual(
        new Set([
          'LOST_CONTACT',
          'BACK_IN_CONTACT',
          'HOME',
          'ACKNOWLEDGED',
          'LOST_CONTACT_SMS',
          'NO_RESPONDER',
        ]),
      );
      expect(before.outbox.filter((row) => row['sent_at'] !== null).length).toBeGreaterThan(0);
      expect(
        before.outbox.filter((row) => row['sent_at'] === null && row['withdrawn_at'] === null)
          .length,
      ).toBeGreaterThan(0);
      expect(before.outbox.filter((row) => row['withdrawn_at'] !== null).length).toBeGreaterThan(0);

      await expect(migrateDatabase(uri)).resolves.toBeUndefined();

      // Every row as it was, column for column: 0008 adds no column.
      expect(await rowsBefore0004(client)).toEqual(before);
      expect({
        alertResolution: await labelsIn(client, 'alert_resolution'),
        messageKind: await labelsIn(client, 'message_kind'),
        journeyEndReason: await labelsIn(client, 'journey_end_reason'),
      }).toEqual({
        alertResolution: ['BACK_IN_CONTACT', 'HOME', 'SAFE', 'EXPIRED'],
        messageKind: [
          'LOST_CONTACT',
          'BACK_IN_CONTACT',
          'HOME',
          'ACKNOWLEDGED',
          'LOST_CONTACT_SMS',
          'NO_RESPONDER',
          'SAFE',
          'EXPIRED',
        ],
        journeyEndReason: ['HOME', 'SAFE', 'EXPIRED'],
      });
      const applied = await client.query<{ n: number }>(
        'select count(*)::int as n from drizzle.__drizzle_migrations',
      );
      expect(applied.rows).toEqual([{ n: journal(MIGRATIONS).entries.length }]);
      expect(journal(MIGRATIONS).entries.map((entry) => entry.idx)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8,
      ]);

      // The values added inside the migration's transaction are usable once
      // it has committed: as a resolution, as an end reason and as a kind.
      const lost = before.alerts.find((row) => row['state'] === 'ACKNOWLEDGED');
      await expect(
        client.query(
          `update alerts set state = 'RESOLVED', resolved_at = now(), resolution = 'SAFE'
            where id = $1`,
          [lost?.['id']],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        client.query(
          `update journeys set state = 'ENDED', ended_at = now(), end_reason = 'SAFE'
            where id = $1`,
          [lost?.['journey_id']],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      const open = before.alerts.find((row) => row['state'] === 'OPEN');
      await expect(
        client.query(
          `update alerts set state = 'RESOLVED', resolved_at = now(), resolution = 'EXPIRED'
            where id = $1`,
          [open?.['id']],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        client.query(
          `update journeys set state = 'ENDED', ended_at = now(), end_reason = 'EXPIRED'
            where id = $1`,
          [open?.['journey_id']],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      const [message] = before.outbox;
      for (const kind of ['SAFE', 'EXPIRED']) {
        await expect(
          client.query(
            `insert into outbox (id, alert_id, recipient_id, kind, created_at, attempts,
                                 next_attempt_at)
             values ($1, $2, $3, $4, now(), 0, now())`,
            [syntheticUuid(), message?.['alert_id'], message?.['recipient_id'], kind],
          ),
          kind,
        ).resolves.toMatchObject({ rowCount: 1 });
      }
    });
  }, 120_000);

  test('LOST-08-AC20: there is exactly one committed 0008 migration, it is in the journal, it holds no update, delete or truncate, and it names SAFE and EXPIRED only in the add value statements of alert_resolution, message_kind and journey_end_reason', () => {
    const files = readdirSync(MIGRATIONS).filter((file) => /^0008_.*\.sql$/.test(file));
    expect(files, 'exactly one 0008 migration').toHaveLength(1);
    expect(journal(MIGRATIONS).entries.map((entry) => `${entry.tag}.sql`)).toContain(files[0]);
    const text = readFileSync(path.join(MIGRATIONS, files[0] ?? ''), 'utf8');
    const statements = text
      .split(/--> statement-breakpoint|;/)
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '');

    expect(text).not.toMatch(/\bupdate\s+("?public"?\.)?"?[a-z_]+"?\s+set\b/i);
    expect(text).not.toMatch(/\bdelete\s+from\b/i);
    expect(text).not.toMatch(/\btruncate\b/i);
    const addsValue = (type: string) =>
      statements.filter((statement) =>
        new RegExp(`^alter type\\s+("?public"?\\.)?"?${type}"?\\s+add value\\b`, 'i').test(
          statement,
        ),
      );
    for (const type of ['alert_resolution', 'message_kind', 'journey_end_reason']) {
      const added = addsValue(type);
      expect(added, type).toHaveLength(2);
      expect(
        added.filter((statement) => statement.includes("'SAFE'")),
        type,
      ).toHaveLength(1);
      expect(
        added.filter((statement) => statement.includes("'EXPIRED'")),
        type,
      ).toHaveLength(1);
    }
    const everyAdd = ['alert_resolution', 'message_kind', 'journey_end_reason'].flatMap(addsValue);
    // 0008 names them nowhere else, so nothing in its transaction uses a new
    // value; and it changes nothing but the three enums.
    expect(
      statements.filter(
        (statement) => /SAFE|EXPIRED/.test(statement) && !everyAdd.includes(statement),
      ),
    ).toEqual([]);
    expect(statements.filter((statement) => !everyAdd.includes(statement))).toEqual([]);
  });
});
