// L3 server integration: the device credential adapter, against a real
// PostgreSQL.
//
// SEC-07: every request is authenticated per device. The server keeps only a
// SHA-256 hash of each device's credential, so a copy of the database holds
// no working credential, and the credential itself is never bound into a
// query or written anywhere. What only a real database can show: that the
// adapter finds a device by that hash, answers null for every credential no
// device has, rejects rather than answering null when it cannot check, and
// that after a credential has been used, no column of any table holds it.
//
// Devices are inserted directly, with hashCredential: nothing in this task
// can create one, by design.
//
// PostgreSQL 15, staging's version. Needs Docker: CI's integration job runs
// it, a cloud session cannot.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  apiPath,
  endTestPool,
  fakeLog,
  syntheticCredential,
  syntheticUuid,
} from '@trygghverdag/test-kit';
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../api.ts';
import { createHealthService } from '../modules/health/service.ts';
import { createJourneyService } from '../modules/journeys/service.ts';
import { databaseClock } from './clock.ts';
import { createDatabase, createPool, POOL_SIZE, type Database } from './db.ts';
import * as credentialsModule from './device-credentials.ts';
import { databaseDeviceAuthenticator, hashCredential } from './device-credentials.ts';
import { databaseJourneyStore } from './journeys.ts';
import { migrateDatabase } from './migrations.ts';
import { databaseWorkerHeartbeats } from './worker-heartbeats.ts';

/** What Clever Cloud's DEV plan runs; see deploy.integration.test.ts. */
const STAGING_POSTGRES = 'postgres:15-alpine';

let container: StartedPostgreSqlContainer | undefined;
let pool: pg.Pool | undefined;
let db: Database | undefined;

beforeAll(async () => {
  container = await new PostgreSqlContainer(STAGING_POSTGRES).start();
  await migrateDatabase(container.getConnectionUri());
  pool = createPool(container.getConnectionUri(), POOL_SIZE.api);
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

async function addUser(): Promise<string> {
  const id = syntheticUuid();
  await connection().query('insert into users (id) values ($1)', [id]);
  return id;
}

/** A device for this user, inserted as the login task will one day insert it: by its hash. */
async function addDevice(userId: string): Promise<{ deviceId: string; credential: string }> {
  const deviceId = syntheticUuid();
  const credential = syntheticCredential();
  await connection().query(
    'insert into devices (id, user_id, credential_hash) values ($1, $2, $3)',
    [deviceId, userId, hashCredential(credential)],
  );
  return { deviceId, credential };
}

/** The forms a hash could take if someone presented it as a credential. */
function presentedForms(hash: unknown): string[] {
  if (typeof hash === 'string') {
    return [hash];
  }
  if (hash instanceof Uint8Array) {
    const bytes = Buffer.from(hash);
    return [bytes.toString('hex'), bytes.toString('base64url'), bytes.toString('base64')];
  }
  throw new Error(`hashCredential returned neither text nor bytes: ${typeof hash}`);
}

function realApi() {
  const clock = databaseClock(database());
  return createApi({
    health: createHealthService({ clock, heartbeats: databaseWorkerHeartbeats(database()) }),
    // RG-03: `log` added because LOST-01 made it a required dependency of the
    // journey service (its spec, approach item 8). The recording fake, as no
    // test here reads what is logged; nothing these tests assert changes.
    journeys: createJourneyService({
      clock,
      journeys: databaseJourneyStore(database()),
      log: fakeLog(),
    }),
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

interface Column {
  schema: string;
  table: string;
  column: string;
  type: string;
}

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** Every column of every table outside PostgreSQL's own schemas that could hold a credential. */
async function columnsThatCouldHoldText(): Promise<Column[]> {
  const result = await connection().query<Column>(
    `select c.table_schema as schema, c.table_name as table, c.column_name as column,
            c.data_type as type
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
      where t.table_type = 'BASE TABLE'
        and c.table_schema not in ('pg_catalog', 'information_schema')
        and c.table_schema not like 'pg\\_%'
        and c.data_type in ('text', 'character varying', 'character', 'json', 'jsonb', 'bytea', 'ARRAY')
      order by 1, 2, 3`,
  );
  return result.rows;
}

/** Whether any row of this column holds the credential: as text, as its bytes, or as the secret it encodes. */
async function columnHolds(column: Column, credential: string): Promise<boolean> {
  const from = `${quoted(column.schema)}.${quoted(column.table)}`;
  const name = quoted(column.column);
  const result =
    column.type === 'bytea'
      ? await connection().query<{ found: boolean }>(
          `select exists (select 1 from ${from}
                           where position($1::bytea in ${name}) > 0
                              or position($2::bytea in ${name}) > 0) as found`,
          [Buffer.from(credential, 'utf8'), Buffer.from(credential, 'base64url')],
        )
      : await connection().query<{ found: boolean }>(
          `select exists (select 1 from ${from} where position($1 in ${name}::text) > 0) as found`,
          [credential],
        );
  return result.rows[0]?.found === true;
}

describe('SEC-07: only a hash of a device credential is kept', () => {
  test('SM-01-AC11: hashCredential is the credential’s SHA-256, and is not the credential', () => {
    const credential = syntheticCredential();
    const hash: unknown = hashCredential(credential);
    const digest = createHash('sha256').update(credential).digest();

    if (typeof hash === 'string') {
      expect([
        digest.toString('hex'),
        digest.toString('base64url'),
        digest.toString('base64'),
      ]).toContain(hash);
    } else {
      expect(hash).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(hash as Uint8Array).equals(digest)).toBe(true);
    }
    expect(presentedForms(hash).join(' ')).not.toContain(credential);
  });

  test('SM-01-AC11: the same credential always hashes the same, and two credentials differently', () => {
    const credential = syntheticCredential();

    expect(hashCredential(credential)).toEqual(hashCredential(credential));
    expect(hashCredential(credential)).not.toEqual(hashCredential(syntheticCredential()));
  });

  test('SM-01-AC11: the devices row holds hashCredential of the credential, and the adapter finds the device by it', async () => {
    const userId = await addUser();
    const { deviceId, credential } = await addDevice(userId);

    const row = await connection().query<{ credential_hash: unknown }>(
      'select credential_hash from devices where id = $1',
      [deviceId],
    );

    expect(row.rows[0]?.credential_hash).toEqual(hashCredential(credential));
    await expect(databaseDeviceAuthenticator(database()).authenticate(credential)).resolves.toEqual(
      { deviceId, userId },
    );
  });

  test('SM-01-AC11: presenting the stored hash instead of the credential gets nothing', async () => {
    const userId = await addUser();
    const { credential } = await addDevice(userId);
    const authenticator = databaseDeviceAuthenticator(database());

    for (const form of presentedForms(hashCredential(credential))) {
      await expect(authenticator.authenticate(form), form).resolves.toBeNull();
    }
  });

  test('SM-01-AC11: after a credential has started a journey, no text, JSON or byte column of any table holds it', async () => {
    const walkerId = await addUser();
    const responderId = await addUser();
    const { credential } = await addDevice(walkerId);

    const response = await realApi().request(apiPath('journeys'), {
      method: 'POST',
      headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
      body: JSON.stringify({ responderIds: [responderId] }),
    });
    expect(response.status).toBe(201);

    const columns = await columnsThatCouldHoldText();
    // The scan is only worth something if it reaches the column that holds
    // the hash: an empty scan would find nothing anywhere.
    expect(columns.map((column) => `${column.table}.${column.column}`)).toContain(
      'devices.credential_hash',
    );
    const holding: string[] = [];
    for (const column of columns) {
      if (await columnHolds(column, credential)) {
        holding.push(`${column.schema}.${column.table}.${column.column}`);
      }
    }
    expect(holding).toEqual([]);
  });
});

describe('SEC-07: the adapter answers who a credential belongs to, and nothing else', () => {
  test('SM-01-AC9: a credential no device has, an empty one, and a removed device’s are all null, never an error', async () => {
    const userId = await addUser();
    const { deviceId, credential } = await addDevice(userId);
    const authenticator = databaseDeviceAuthenticator(database());

    await expect(authenticator.authenticate(syntheticCredential())).resolves.toBeNull();
    await expect(authenticator.authenticate('')).resolves.toBeNull();

    await connection().query('delete from devices where id = $1', [deviceId]);

    await expect(authenticator.authenticate(credential)).resolves.toBeNull();
  });

  test('SM-01-AC9: two devices of one user each answer with their own device and that user', async () => {
    const userId = await addUser();
    const phone = await addDevice(userId);
    const tablet = await addDevice(userId);
    const authenticator = databaseDeviceAuthenticator(database());

    await expect(authenticator.authenticate(phone.credential)).resolves.toEqual({
      deviceId: phone.deviceId,
      userId,
    });
    await expect(authenticator.authenticate(tablet.credential)).resolves.toEqual({
      deviceId: tablet.deviceId,
      userId,
    });
  });

  test('SM-01-AC12: when the database cannot answer, the adapter rejects rather than answering null', async () => {
    // null would read as "not a valid credential", and the API would answer
    // 401: an app told its credential is bad because the database blinked.
    const userId = await addUser();
    const { credential } = await addDevice(userId);
    const gone = createPool(connectionUri(), 1);
    await gone.end();

    await expect(
      databaseDeviceAuthenticator(createDatabase(gone)).authenticate(credential),
    ).rejects.toThrow();
  });

  test('SM-01-AC13: the adapter can only check a credential; it has no way to create a user, a device or a credential', () => {
    // Before the login task nobody may be issued a credential, so the
    // production adapter has no insert of its own. Tests insert rows
    // directly, as above.
    expect(Object.keys(credentialsModule).sort()).toEqual([
      'databaseDeviceAuthenticator',
      'hashCredential',
    ]);
    expect(Object.keys(databaseDeviceAuthenticator(database()))).toEqual(['authenticate']);
  });
});
