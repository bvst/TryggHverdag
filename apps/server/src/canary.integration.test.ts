// L3 server integration: the staging canary against a real PostgreSQL
// (REL-10; D-091 as D-128 amends it, D-128).
//
// The system tests run the canary against the fake journey store. Only a
// real database can prove what its adapter does to the real tables:
//   - registration is one transaction that makes exactly the canary's three
//     rows, and nothing else in the code makes a credential (D-091's one
//     exception): a freshly migrated database still holds no user and no
//     device, and the API authenticates the canary's credential as its device
//     only once it is registered; a rotated credential replaces the old one;
//     a device of the canary's ID owned by anyone else is refused, writing
//     nothing (AC10);
//   - the canary's read reads only its own walker's journeys, at the
//     statement's now(), each time the row's own (AC11);
//   - two runs started together on one database, as the old and the new
//     worker in a deploy, start one journey between them: the unique index
//     holds one unended journey per walker (AC8);
//   - the responder never gets a device, and the canary's heartbeat carries
//     no battery level and no position (AC14);
//   - and the shared behaviour suite's three cases, which the fake passes at
//     L2 (D-100).
//
// Each test that needs it gets a database of its own: the canary's IDs are
// fixed, so its rows in one database are its rows in every test there.
//
// PostgreSQL 15, staging's version, as deploy.integration.test.ts explains.
// Needs Docker, like every *.integration.test.ts: CI's integration job runs
// it, a cloud session cannot.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { API_PREFIX, openApiDocument } from '@trygghverdag/contracts';
import {
  CANARY_IDS,
  CANARY_STORE_BEHAVIOUR,
  apiPath,
  endTestPool,
  fakeCanaryAlarm,
  fakeLog,
  syntheticCredential,
  syntheticPingUrl,
  syntheticUuid,
  type AlertAsStored,
  type CanaryStoreUnderTest,
  type FakeAlertResolution,
  type FakeAlertState,
  type FakeJourneyState,
  type MessageAsStored,
  type ResolutionAsStored,
} from '@trygghverdag/test-kit';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import type { RunnerOptions } from 'graphile-worker';
import type pg from 'pg';
import { afterAll, describe, expect, test } from 'vitest';
import { databaseCanaryStore, httpCanaryClient } from './adapters/canary.ts';
import { databaseClock } from './adapters/clock.ts';
import { createDatabase, createPool, type Database } from './adapters/db.ts';
import { databaseDeviceAuthenticator, hashCredential } from './adapters/device-credentials.ts';
import { databaseJourneyStore } from './adapters/journeys.ts';
import { migrateDatabase } from './adapters/migrations.ts';
import { databaseWorkerHeartbeats } from './adapters/worker-heartbeats.ts';
import { createApi } from './api.ts';
import { CANARY_DEVICE_ID, CANARY_RESPONDER_ID, CANARY_WALKER_ID } from './domain/canary.ts';
import { createAcknowledgementService } from './modules/alerts/acknowledgement.ts';
import { createClosureService } from './modules/alerts/closure.ts';
import { createCanary } from './modules/canary/run.ts';
import { createHealthService } from './modules/health/service.ts';
import { createJourneyService } from './modules/journeys/service.ts';
import { readCanarySetting, readHealthchecksCanarySetting } from './config.ts';
import { runWorkerProcess, type RunWorker } from './worker.ts';

/** What Clever Cloud's DEV plan runs; see deploy.integration.test.ts. */
const STAGING_POSTGRES = 'postgres:15-alpine';

/** Where the canary's API is, for these tests: https, as staging's is, and only ever reached in-process. */
const ORIGIN = 'https://canary-api.invalid';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const started: { container: StartedPostgreSqlContainer; pool: pg.Pool }[] = [];

afterAll(async () => {
  // endTestPool, not pool.end() alone: see journeys.integration.test.ts.
  for (const { container, pool } of started.splice(0)) {
    await endTestPool(pool);
    await container.stop();
  }
}, 180_000);

/** A moment as milliseconds since the epoch, in SQL, floored as a Date floors it. */
const MS = (column: string) => `floor(extract(epoch from ${column}) * 1000)::bigint::text`;

/** A moment read back to the millisecond, or null. */
const momentOf = (ms: string | null | undefined): Date | null =>
  ms === null || ms === undefined ? null : new Date(Number(ms));

/**
 * A database of its own, migrated by the deploy's own migration step, with
 * the adapters over it and the rows a test puts in and reads back directly.
 */
async function freshDatabase() {
  const container = await new PostgreSqlContainer(STAGING_POSTGRES).start();
  await migrateDatabase(container.getConnectionUri());
  const pool = createPool(container.getConnectionUri(), 8);
  started.push({ container, pool });
  const db: Database = createDatabase(pool);
  const query = <T extends pg.QueryResultRow>(text: string, values: unknown[] = []) =>
    pool.query<T>(text, values);

  const rows = {
    pool,
    db,
    query,
    canary: databaseCanaryStore(db),
    journeys: databaseJourneyStore(db),
    async nowMs(): Promise<number> {
      const result = await query<{ ms: string }>(`select ${MS('now()')} as ms`);
      return Number(result.rows[0]?.ms);
    },
    async addUser(id: string = syntheticUuid()): Promise<string> {
      await query('insert into users (id) values ($1)', [id]);
      return id;
    },
    async addDevice(
      userId: string,
      deviceId: string = syntheticUuid(),
      credentialHash: string = hashCredential(syntheticCredential()),
    ): Promise<string> {
      await query('insert into devices (id, user_id, credential_hash) values ($1, $2, $3)', [
        deviceId,
        userId,
        credentialHash,
      ]);
      return deviceId;
    },
    async users(): Promise<{ id: string; createdMs: string }[]> {
      const result = await query<{ id: string; created_ms: string }>(
        `select id::text as id, ${MS('created_at')} as created_ms from users order by id`,
      );
      return result.rows.map((row) => ({ id: row.id, createdMs: row.created_ms }));
    },
    async devices(): Promise<
      { id: string; userId: string; credentialHash: string; createdMs: string }[]
    > {
      const result = await query<{
        id: string;
        user_id: string;
        credential_hash: string;
        created_ms: string;
      }>(
        `select id::text as id, user_id::text as user_id, credential_hash,
                ${MS('created_at')} as created_ms
           from devices order by id`,
      );
      return result.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        credentialHash: row.credential_hash,
        createdMs: row.created_ms,
      }));
    },
    async seedJourney({
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
      const client = await pool.connect();
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
    },
    async seedAlert({
      journeyId,
      state,
      openedAt,
      silentSince,
      resolvedAt = null,
      resolution = null,
      acknowledgedBy = null,
      acknowledgedAt = null,
      smsRaisedAt = null,
    }: {
      journeyId: string;
      state: FakeAlertState;
      openedAt: Date;
      silentSince: Date;
      resolvedAt?: Date | null;
      resolution?: FakeAlertResolution | null;
      acknowledgedBy?: string | null;
      acknowledgedAt?: Date | null;
      smsRaisedAt?: Date | null;
    }): Promise<string> {
      const id = syntheticUuid();
      await query(
        `insert into alerts (id, journey_id, state, opened_at, silent_since, resolved_at,
                             resolution, acknowledged_by, acknowledged_at, sms_raised_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
          smsRaisedAt,
        ],
      );
      return id;
    },
    async seedMessage({
      alertId,
      recipientId,
      kind,
      createdAt,
      nextAttemptAt,
      attempts = 0,
      sentAt = null,
      lastFailure = null,
      withdrawnAt = null,
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
    }): Promise<string> {
      const id = syntheticUuid();
      await query(
        `insert into outbox (id, alert_id, recipient_id, kind, created_at, attempts,
                             next_attempt_at, sent_at, last_failure, withdrawn_at)
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
          withdrawnAt,
        ],
      );
      return id;
    },
    async alertsOf(journeyId: string): Promise<AlertAsStored[]> {
      const result = await query<{
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
    },
    async resolutionsOf(journeyId: string): Promise<ResolutionAsStored[]> {
      const result = await query<{
        id: string;
        resolved_ms: string | null;
        resolution: string | null;
      }>(
        `select id::text as id, ${MS('resolved_at')} as resolved_ms,
                resolution::text as resolution
           from alerts where journey_id = $1 order by opened_at, id`,
        [journeyId],
      );
      return result.rows.map((row) => ({
        alertId: row.id,
        resolvedAt: momentOf(row.resolved_ms),
        resolution: row.resolution,
      }));
    },
    async messagesOf(journeyId: string): Promise<MessageAsStored[]> {
      const result = await query<{
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
    },
    async lastHeartbeatAt(journeyId: string): Promise<Date | null> {
      const result = await query<{ ms: string | null }>(
        `select ${MS('last_heartbeat_at')} as ms from journeys where id = $1`,
        [journeyId],
      );
      return momentOf(result.rows[0]?.ms);
    },
    async startedAt(journeyId: string): Promise<Date | null> {
      const result = await query<{ ms: string | null }>(
        `select ${MS('started_at')} as ms from journeys where id = $1`,
        [journeyId],
      );
      return momentOf(result.rows[0]?.ms);
    },
    async endOf(
      journeyId: string,
    ): Promise<{ endedAt: Date | null; endReason: string | null } | null> {
      const result = await query<{ ended_ms: string | null; end_reason: string | null }>(
        `select ${MS('ended_at')} as ended_ms, end_reason::text as end_reason
           from journeys where id = $1`,
        [journeyId],
      );
      const row = result.rows[0];
      return row === undefined
        ? null
        : { endedAt: momentOf(row.ended_ms), endReason: row.end_reason };
    },
    async journeysOf(walkerId: string): Promise<{ id: string; state: string }[]> {
      const result = await query<{ id: string; state: string }>(
        'select id::text as id, state::text as state from journeys where walker_id = $1 order by started_at, id',
        [walkerId],
      );
      return result.rows;
    },
    /** The API as the API process builds it, over this database, with its real authenticator. */
    api() {
      const log = fakeLog();
      const clock = databaseClock(db);
      return createApi({
        health: createHealthService({ clock, heartbeats: databaseWorkerHeartbeats(db) }),
        journeys: createJourneyService({ clock, journeys: rows.journeys, log }),
        devices: databaseDeviceAuthenticator(db),
        acknowledgements: createAcknowledgementService({ alerts: rows.journeys, log }),
        closures: createClosureService({ alerts: rows.journeys, log }),
      });
    },
  };
  return rows;
}

type Rows = Awaited<ReturnType<typeof freshDatabase>>;

/** The canary store's subject over a database of its own (CANARY_STORE_BEHAVIOUR). */
async function underTest(): Promise<CanaryStoreUnderTest> {
  const rows = await freshDatabase();
  return {
    store: {
      registerCanary: (request) => rows.canary.registerCanary(request),
      observeCanaryJourney: (journeyId) => rows.canary.observeCanaryJourney(journeyId),
      existingUsers: (ids) => rows.journeys.existingUsers(ids),
      insertStarted: (journey) => rows.journeys.insertStarted(journey),
      unendedJourneyOf: (walkerId) => rows.journeys.unendedJourneyOf(walkerId),
      overdueJourneys: (afterMs) => rows.journeys.overdueJourneys(afterMs),
      openLostContactAlert: (request) => rows.journeys.openLostContactAlert(request),
      markSent: (messageId) => rows.journeys.markSent(messageId),
      markFailed: (request) => rows.journeys.markFailed(request),
      recordHome: (home) => rows.journeys.recordHome(home),
    },
    now: async () => new Date(await rows.nowMs()),
    addUser: () => rows.addUser(),
    addDevice: (userId, deviceId) => rows.addDevice(userId, deviceId),
    removeDevice: async (deviceId) => {
      await rows.query('delete from devices where id = $1', [deviceId]);
    },
    devicesOf: async (userId) =>
      (await rows.devices())
        .filter((device) => device.userId === userId)
        .map(({ id, credentialHash }) => ({ id, credentialHash })),
    seedJourney: (journey) => rows.seedJourney(journey),
    seedAlert: (alert) => rows.seedAlert(alert),
    seedMessage: (message) => rows.seedMessage(message),
    alertsOf: (journeyId) => rows.alertsOf(journeyId),
    resolutionsOf: (journeyId) => rows.resolutionsOf(journeyId),
    messagesOf: (journeyId) => rows.messagesOf(journeyId),
    lastHeartbeatAt: (journeyId) => rows.lastHeartbeatAt(journeyId),
    endOf: (journeyId) => rows.endOf(journeyId),
  };
}

describe('databaseCanaryStore, against the behaviour the canary’s store shares with the fake', () => {
  test.each(CANARY_STORE_BEHAVIOUR)(
    '$name',
    async ({ run }) => {
      await run(await underTest());
    },
    180_000,
  );
});

/** A POST to the API, with this credential, or none. */
async function post(
  api: ReturnType<Rows['api']>,
  path: string,
  credential: string | null,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (credential !== null) {
    headers['authorization'] = `Bearer ${credential}`;
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const response = await api.request(path, {
    method: 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const parsed = ((): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  })();
  return { status: response.status, body: parsed };
}

describe('REL-10: the canary’s registration, on the real tables', () => {
  test('REL-10-AC14: the canary’s IDs are the test kit’s, so the shared suite above looked for the rows this adapter writes', () => {
    expect({
      walkerId: CANARY_WALKER_ID,
      responderId: CANARY_RESPONDER_ID,
      deviceId: CANARY_DEVICE_ID,
    }).toEqual(CANARY_IDS);
  });

  test('REL-10-AC10: a freshly migrated database holds no user and no device; registration makes the walker and the responder and the walker’s one device with the credential’s hash; the responder has no device; and the API then authenticates the credential as the canary’s device', async () => {
    const rows = await freshDatabase();
    const credential = syntheticCredential();

    expect(await rows.users()).toEqual([]);
    expect(await rows.devices()).toEqual([]);

    await rows.canary.registerCanary({ credentialHash: hashCredential(credential) });

    expect((await rows.users()).map(({ id }) => id)).toEqual(
      [CANARY_WALKER_ID, CANARY_RESPONDER_ID].sort(),
    );
    const devices = await rows.devices();
    expect(
      devices.map(({ id, userId, credentialHash }) => ({ id, userId, credentialHash })),
    ).toEqual([
      {
        id: CANARY_DEVICE_ID,
        userId: CANARY_WALKER_ID,
        credentialHash: hashCredential(credential),
      },
    ]);
    expect(await databaseDeviceAuthenticator(rows.db).authenticate(credential)).toEqual({
      deviceId: CANARY_DEVICE_ID,
      userId: CANARY_WALKER_ID,
    });

    // Through the API: a start with the canary's credential naming its
    // responder is the canary's walker's, from its device.
    const api = rows.api();
    const start = await post(api, apiPath('journeys'), credential, {
      responderIds: [CANARY_RESPONDER_ID],
    });
    expect(start.status).toBe(201);
    const journeyId = (start.body as { journeyId: string }).journeyId;
    const stored = await rows.query<{ walker_id: string; device_id: string }>(
      'select walker_id::text as walker_id, device_id::text as device_id from journeys where id = $1',
      [journeyId],
    );
    expect(stored.rows).toEqual([{ walker_id: CANARY_WALKER_ID, device_id: CANARY_DEVICE_ID }]);
  });

  test('REL-10-AC10: registering again changes nothing, its rows’ creation times included; with another credential’s hash, the device holds the new hash, the old credential is answered 401 and the new one is the canary’s device', async () => {
    const rows = await freshDatabase();
    const [first, second] = [syntheticCredential(), syntheticCredential()];
    await rows.canary.registerCanary({ credentialHash: hashCredential(first) });
    const [users, devices] = [await rows.users(), await rows.devices()];

    await rows.canary.registerCanary({ credentialHash: hashCredential(first) });

    expect(await rows.users()).toEqual(users);
    expect(await rows.devices()).toEqual(devices);

    await rows.canary.registerCanary({ credentialHash: hashCredential(second) });

    expect(await rows.users()).toEqual(users);
    expect(
      (await rows.devices()).map(({ id, userId, credentialHash }) => ({
        id,
        userId,
        credentialHash,
      })),
    ).toEqual([
      { id: CANARY_DEVICE_ID, userId: CANARY_WALKER_ID, credentialHash: hashCredential(second) },
    ]);
    const authenticator = databaseDeviceAuthenticator(rows.db);
    expect(await authenticator.authenticate(first)).toBeNull();
    expect(await authenticator.authenticate(second)).toEqual({
      deviceId: CANARY_DEVICE_ID,
      userId: CANARY_WALKER_ID,
    });
    const api = rows.api();
    const body = { responderIds: [CANARY_RESPONDER_ID] };
    expect((await post(api, apiPath('journeys'), first, body)).status).toBe(401);
    expect((await post(api, apiPath('journeys'), second, body)).status).toBe(201);
  });

  test('REL-10-AC10: a device with the canary’s ID belonging to another user makes registration throw, writing nothing', async () => {
    const rows = await freshDatabase();
    const someone = await rows.addUser();
    const hash = hashCredential(syntheticCredential());
    await rows.addDevice(someone, CANARY_DEVICE_ID, hash);
    const [users, devices] = [await rows.users(), await rows.devices()];

    await expect(
      rows.canary.registerCanary({ credentialHash: hashCredential(syntheticCredential()) }),
    ).rejects.toThrow();

    expect(await rows.users()).toEqual(users);
    expect(await rows.devices()).toEqual(devices);
  });

  test('REL-10-AC10: registration is one transaction: a credential’s hash another device holds is refused by the unique index, and neither user is written', async () => {
    const rows = await freshDatabase();
    const someone = await rows.addUser();
    const hash = hashCredential(syntheticCredential());
    await rows.addDevice(someone, syntheticUuid(), hash);
    const [users, devices] = [await rows.users(), await rows.devices()];

    await expect(rows.canary.registerCanary({ credentialHash: hash })).rejects.toThrow();

    expect(await rows.users()).toEqual(users);
    expect(await rows.devices()).toEqual(devices);
  });

  test('REL-10-AC10: after the canary’s registration, without a credential every route but health still answers 401', async () => {
    const rows = await freshDatabase();
    await rows.canary.registerCanary({ credentialHash: hashCredential(syntheticCredential()) });
    const api = rows.api();
    const document = await openApiDocument();
    const paths = document['paths'] as Record<string, Record<string, unknown>>;
    const routes = Object.entries(paths).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((method) => ['get', 'put', 'post', 'delete', 'patch'].includes(method))
        .map((method) => ({
          key: `${method.toUpperCase()} ${API_PREFIX}${path}`,
          method: method.toUpperCase(),
          path: `${API_PREFIX}${path.replace(/\{[^}]*\}/g, () => syntheticUuid())}`,
        })),
    );
    const guarded = routes.filter(({ key }) => key !== `GET ${API_PREFIX}/health`);

    expect(guarded.length).toBeGreaterThan(0);
    for (const route of guarded) {
      const response = await api.request(route.path, {
        method: route.method,
        headers: { 'content-type': 'application/json' },
        ...(route.method === 'GET' ? {} : { body: '{}' }),
      });
      expect({ route: route.key, status: response.status }).toEqual({
        route: route.key,
        status: 401,
      });
    }
    expect(await rows.journeysOf(CANARY_WALKER_ID)).toEqual([]);
  });
});

describe('REL-10: the canary reads only its own journeys, on the real tables', () => {
  test('REL-10-AC11: observeCanaryJourney is null for every other walker’s journey, in every state and end reason, with alerts in every state and messages of every kind, and the canary’s own reflects only its alert and its messages to its responder', async () => {
    const rows = await freshDatabase();
    await rows.canary.registerCanary({ credentialHash: hashCredential(syntheticCredential()) });
    const now = new Date(await rows.nowMs());
    const at = (ms: number) => new Date(now.getTime() + ms);
    const someone = await rows.addUser();
    const others: string[] = [];
    const kinds = [
      'LOST_CONTACT',
      'BACK_IN_CONTACT',
      'HOME',
      'ACKNOWLEDGED',
      'LOST_CONTACT_SMS',
      'SAFE',
      'EXPIRED',
    ];

    const shapes: { state: FakeJourneyState; endReason?: string; unresolved?: FakeAlertState }[] = [
      { state: 'ACTIVE' },
      { state: 'LOST_CONTACT', unresolved: 'OPEN' },
      { state: 'LOST_CONTACT', unresolved: 'ESCALATED' },
      { state: 'LOST_CONTACT', unresolved: 'ACKNOWLEDGED' },
      { state: 'ENDED' },
      { state: 'ENDED', endReason: 'HOME' },
      { state: 'ENDED', endReason: 'SAFE' },
      { state: 'ENDED', endReason: 'EXPIRED' },
    ];
    for (const { state, endReason, unresolved } of shapes) {
      const walker = await rows.addUser();
      const device = await rows.addDevice(walker);
      const journeyId = await rows.seedJourney({
        walkerId: walker,
        deviceId: device,
        state,
        responderIds: [CANARY_RESPONDER_ID, someone],
        startedAt: at(-2 * HOUR),
        lastHeartbeatAt: at(-HOUR - 10 * MINUTE),
      });
      others.push(journeyId);
      if (endReason !== undefined) {
        await rows.query('update journeys set ended_at = $2, end_reason = $3 where id = $1', [
          journeyId,
          at(-30 * MINUTE),
          endReason,
        ]);
      }
      if (state === 'ACTIVE') {
        continue;
      }
      const alertIds = [
        await rows.seedAlert({
          journeyId,
          state: 'RESOLVED',
          openedAt: at(-2 * HOUR + 10 * MINUTE),
          silentSince: at(-2 * HOUR + 5 * MINUTE),
          resolvedAt: at(-2 * HOUR + 15 * MINUTE),
          resolution: 'BACK_IN_CONTACT',
        }),
      ];
      if (unresolved !== undefined) {
        alertIds.push(
          await rows.seedAlert({
            journeyId,
            state: unresolved,
            openedAt: at(-HOUR),
            silentSince: at(-HOUR - 10 * MINUTE),
            ...(unresolved === 'ACKNOWLEDGED'
              ? { acknowledgedBy: someone, acknowledgedAt: at(-HOUR + MINUTE) }
              : {}),
            ...(unresolved === 'ESCALATED' ? { smsRaisedAt: at(-HOUR + 2 * MINUTE) } : {}),
          }),
        );
      }
      for (const alertId of alertIds) {
        for (const kind of kinds) {
          await rows.seedMessage({
            alertId,
            recipientId: CANARY_RESPONDER_ID,
            kind,
            createdAt: at(-HOUR),
            nextAttemptAt: at(-HOUR),
            attempts: 1,
            sentAt: kind === 'HOME' ? at(-HOUR) : null,
            lastFailure: kind === 'HOME' ? null : 'NOT_CONFIGURED',
          });
        }
      }
      // And a journey's own message, the walker's warning.
      await rows.query(
        `insert into outbox (id, journey_id, recipient_id, kind, created_at, next_attempt_at)
         values ($1, $2, $3, 'NO_RESPONDER', $4, $4)`,
        [syntheticUuid(), journeyId, walker, at(-HOUR)],
      );
    }

    // The canary's journey: LOST_CONTACT, its alert open, the responder's
    // lost-contact message unanswered, and one to someone else answered.
    const startedAt = at(-10 * MINUTE);
    const lastContact = at(-8 * MINUTE);
    const journeyId = await rows.seedJourney({
      walkerId: CANARY_WALKER_ID,
      deviceId: CANARY_DEVICE_ID,
      state: 'LOST_CONTACT',
      responderIds: [CANARY_RESPONDER_ID],
      startedAt,
      lastHeartbeatAt: lastContact,
    });
    const openedAt = at(-3 * MINUTE);
    const alertId = await rows.seedAlert({
      journeyId,
      state: 'OPEN',
      openedAt,
      silentSince: lastContact,
    });
    await rows.seedMessage({
      alertId,
      recipientId: CANARY_RESPONDER_ID,
      kind: 'LOST_CONTACT',
      createdAt: openedAt,
      nextAttemptAt: openedAt,
    });
    await rows.seedMessage({
      alertId,
      recipientId: someone,
      kind: 'LOST_CONTACT',
      createdAt: openedAt,
      nextAttemptAt: openedAt,
      attempts: 1,
      lastFailure: 'NOT_CONFIGURED',
    });
    await rows.seedMessage({
      alertId,
      recipientId: someone,
      kind: 'HOME',
      createdAt: openedAt,
      nextAttemptAt: openedAt,
      sentAt: openedAt,
    });

    for (const other of [...others, syntheticUuid()]) {
      expect(await rows.canary.observeCanaryJourney(other), other).toBeNull();
    }
    const observation = await rows.canary.observeCanaryJourney(journeyId);
    expect({ ...observation, now: null }).toEqual({
      now: null,
      journey: { state: 'LOST_CONTACT', startedAt, lastHeartbeatAt: lastContact, endReason: null },
      alert: { id: alertId, openedAt, state: 'OPEN', resolution: null, resolvedAt: null },
      lostContactAnswered: false,
      standDownAnswered: false,
      smsWritten: 0,
    });
  }, 180_000);

  test('REL-10-AC11: the observation’s now is the statement’s now(), and its other times are the rows’ own, read back to the millisecond', async () => {
    const rows = await freshDatabase();
    await rows.canary.registerCanary({ credentialHash: hashCredential(syntheticCredential()) });
    const now = new Date(await rows.nowMs());
    // Times with milliseconds of their own, so a rounding is seen.
    const startedAt = new Date(now.getTime() - 9 * MINUTE - 123);
    const lastContact = new Date(now.getTime() - 7 * MINUTE - 457);
    const journeyId = await rows.seedJourney({
      walkerId: CANARY_WALKER_ID,
      deviceId: CANARY_DEVICE_ID,
      state: 'ACTIVE',
      responderIds: [CANARY_RESPONDER_ID],
      startedAt,
      lastHeartbeatAt: lastContact,
    });
    const opened = await rows.journeys.openLostContactAlert({ journeyId, afterMs: 5 * MINUTE });
    expect(opened.outcome).toBe('opened');
    await rows.journeys.recordHome({
      journeyId,
      walkerId: CANARY_WALKER_ID,
      deviceId: CANARY_DEVICE_ID,
    });

    const before = await rows.nowMs();
    const observation = await rows.canary.observeCanaryJourney(journeyId);
    const after = await rows.nowMs();

    expect(observation?.now.getTime()).toBeGreaterThanOrEqual(before);
    expect(observation?.now.getTime()).toBeLessThanOrEqual(after);
    expect(observation?.journey.startedAt).toEqual(await rows.startedAt(journeyId));
    expect(observation?.journey.lastHeartbeatAt).toEqual(await rows.lastHeartbeatAt(journeyId));
    expect(observation?.journey.endReason).toBe((await rows.endOf(journeyId))?.endReason);
    const [alert] = await rows.alertsOf(journeyId);
    const [resolution] = await rows.resolutionsOf(journeyId);
    expect(observation?.alert).toEqual({
      id: alert?.id,
      openedAt: alert?.openedAt,
      state: 'RESOLVED',
      resolution: 'HOME',
      resolvedAt: resolution?.resolvedAt,
    });
  }, 180_000);
});

describe('REL-10: two runs on one database', () => {
  test('REL-10-AC8: two runs started together, as the old and the new worker in a deploy: exactly one starts a journey, the other writes canary_skipped and ends nothing, sends nothing more and reports nothing; the walker never has two unended journeys; and the run in flight, stopped, ends its journey (AC9, AC14)', async () => {
    const rows = await freshDatabase();
    const api = rows.api();
    const credential = syntheticCredential();
    const fetch: typeof globalThis.fetch = async (input, init) =>
      api.fetch(new Request(input, init));
    const wait = (ms: number, signal: AbortSignal) => sleep(ms, undefined, { signal });
    const workers = [0, 1].map(() => {
      const alarm = fakeCanaryAlarm();
      const log = fakeLog();
      const sent: string[] = [];
      const canary = createCanary({
        client: httpCanaryClient({
          baseUrl: ORIGIN,
          credential,
          fetch: (input, init) => {
            sent.push(new URL(new Request(input, init).url).pathname);
            return fetch(input, init);
          },
        }),
        store: databaseCanaryStore(rows.db),
        credentialHash: hashCredential(credential),
        alarm,
        log,
        wait,
      });
      return { alarm, log, sent, canary, stop: new AbortController() };
    });

    const runs = workers.map(({ canary, stop }) => canary.run(stop.signal));
    const first = await Promise.race(runs);

    expect(first).toEqual({ skipped: 'RUN_IN_FLIGHT' });
    const skippedAt = workers.findIndex(({ log }) =>
      log.events.some(({ event }) => event === 'canary_skipped'),
    );
    expect(skippedAt).not.toBe(-1);
    const skipped = workers[skippedAt];
    const running = workers[1 - skippedAt];
    expect(skipped?.log.events).toEqual([{ event: 'canary_skipped', reason: 'RUN_IN_FLIGHT' }]);
    expect(skipped?.alarm.reports).toEqual([]);
    expect(skipped?.sent).toEqual([apiPath('journeys')]);

    // One journey, the walker's only unended one, held by the unique index;
    // its heartbeat has no battery level and no position (AC14).
    const journeys = await rows.journeysOf(CANARY_WALKER_ID);
    expect(journeys).toHaveLength(1);
    expect(journeys.filter(({ state }) => state !== 'ENDED')).toHaveLength(1);
    const [journey] = journeys;
    for (
      let turn = 0;
      turn < 200 && (await rows.lastHeartbeatAt(journey?.id ?? '')) === null;
      turn += 1
    ) {
      await sleep(10);
    }
    const heartbeats = await rows.query<{ battery_level: number | null }>(
      'select battery_level::float8 as battery_level from heartbeats where journey_id = $1',
      [journey?.id],
    );
    expect(heartbeats.rows).toEqual([{ battery_level: null }]);
    const positions = await rows.query(
      'select p.* from positions p join heartbeats h on h.id = p.heartbeat_id where h.journey_id = $1',
      [journey?.id],
    );
    expect(positions.rows).toEqual([]);
    expect((await rows.devices()).filter(({ userId }) => userId === CANARY_RESPONDER_ID)).toEqual(
      [],
    );

    // The run in flight, stopped as the worker stops it: it ends its journey,
    // writes INTERRUPTED and reports nothing.
    running?.stop.abort();
    const results = await Promise.all(runs);

    expect(results).toEqual(
      expect.arrayContaining([{ skipped: 'RUN_IN_FLIGHT' }, { outcome: 'INTERRUPTED' }]),
    );
    expect((await rows.endOf(journey?.id ?? ''))?.endReason).toBe('HOME');
    expect(running?.alarm.reports).toEqual([]);
    expect(running?.log.events).toEqual([
      expect.objectContaining({ event: 'canary_run', outcome: 'INTERRUPTED' }),
    ]);
    expect(await rows.journeysOf(CANARY_WALKER_ID)).toEqual([{ id: journey?.id, state: 'ENDED' }]);
  }, 180_000);
});

describe('REL-10: what the real worker registers, on the real tables', () => {
  // REL-10 review loop 2 (test-auditor should-fix 3, its W3): what the worker
  // hands the canary as the hash to register was seen by no test. The worker
  // tests replace the store and the client, and the L3 tests above call the
  // adapter themselves. Here runWorkerProcess is given the canary's settings,
  // as bin/worker.ts gives them from the environment, and a database of its
  // own; Graphile is replaced by a runner that only keeps the task list, so
  // the canary's task is run once, by hand. Its client answers the start 503,
  // so the run ends right after its registration, which is the real adapter
  // on the real tables. The device row must then hold the hash of
  // CANARY_CREDENTIAL itself, the one the API authenticates.
  test('REL-10-AC10: the real worker, given the canary’s three settings, registers on its first run the hash of CANARY_CREDENTIAL itself: the canary’s device holds hashCredential(credential), and the API takes the credential as that device', async () => {
    const rows = await freshDatabase();
    const uri = started.at(-1)?.container.getConnectionUri() ?? '';
    const credential = syntheticCredential();
    let options: RunnerOptions | undefined;
    let finish: () => void = () => undefined;
    const runWorker = ((given: RunnerOptions) => {
      options = given;
      return Promise.resolve({
        promise: new Promise<void>((resolve) => {
          finish = resolve;
        }),
        stop: () => {
          finish();
          return Promise.resolve();
        },
      });
    }) as unknown as RunWorker;
    const clients: { baseUrl: string; credential: string }[] = [];
    const alarm = fakeCanaryAlarm();
    const log = fakeLog();
    const signals = new EventEmitter();
    const exits: number[] = [];

    const running = runWorkerProcess(uri, {
      runWorker,
      signals,
      keepAlive: () => undefined,
      write: () => undefined,
      exit: (code) => {
        exits.push(code);
      },
      healthchecksCanary: readHealthchecksCanarySetting({
        HEALTHCHECKS_CANARY_URL: syntheticPingUrl(),
      }),
      canary: readCanarySetting({ CANARY_API_URL: ORIGIN, CANARY_CREDENTIAL: credential }),
      createCanaryAlarm: () => alarm,
      createCanaryClient: (made) => {
        clients.push({ ...made });
        const refused = () => Promise.resolve({ ok: false as const, status: 503, code: null });
        return { start: refused, heartbeat: refused, home: refused };
      },
      log,
      watchdog: { sweep: () => Promise.resolve({ ok: true, opened: 0, escalated: 0, stuck: 0 }) },
      sender: { deliverDue: () => Promise.resolve({ sent: 0, failed: 0 }) },
      smsSender: { deliverDue: () => Promise.resolve({ sent: 0, failed: 0 }) },
    });
    for (let turn = 0; turn < 200 && options === undefined; turn += 1) {
      await sleep(10);
    }
    const { canary: canaryTask } = options?.taskList ?? {};
    expect(canaryTask, 'the canary’s task').toBeDefined();

    await canaryTask?.(null, { abortSignal: new AbortController().signal } as never);

    expect(clients).toEqual([{ baseUrl: ORIGIN, credential }]);
    expect(log.events.filter(({ event }) => event === 'canary_run')).toEqual([
      expect.objectContaining({ outcome: 'START_FAILED', status: 503 }),
    ]);
    expect(
      (await rows.devices()).map(({ id, userId, credentialHash }) => ({
        id,
        userId,
        credentialHash,
      })),
    ).toEqual([
      {
        id: CANARY_DEVICE_ID,
        userId: CANARY_WALKER_ID,
        credentialHash: hashCredential(credential),
      },
    ]);
    expect(await databaseDeviceAuthenticator(rows.db).authenticate(credential)).toEqual({
      userId: CANARY_WALKER_ID,
      deviceId: CANARY_DEVICE_ID,
    });

    signals.emit('SIGTERM');
    await expect(running).resolves.toBeUndefined();
    for (let turn = 0; turn < 200 && exits.length === 0; turn += 1) {
      await sleep(10);
    }
    expect(exits).toEqual([0]);
  });
});
