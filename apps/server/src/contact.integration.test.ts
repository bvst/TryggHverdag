// L3 server integration: back in contact (LOST-03) and "I'm home" after an
// alert (SM-04) on the real tables.
//
// The system tests prove the rules and the flows against a fake store. What
// only a real PostgreSQL can prove is here:
//   - the flows, through the real adapter and the real modules, with times
//     written relative to the database's own now() (AC1, AC14);
//   - the database's own refusals and records: one stand-down per (alert,
//     recipient, kind) (AC6), the columns this task adds and no personal
//     data in them (AC9), every time the database's now() (AC13);
//   - the withdrawal meeting a claim and a mark in progress on another
//     session, and the hold it leaves on a stand-down (AC7, AC8);
//   - all or nothing, with a test trigger that fails the second stand-down
//     (AC10, AC17);
//   - a heartbeat, "I'm home" and the watchdog meeting on the journey's row,
//     in each order and at the same moment (AC11, AC12, AC17).
// The shared behaviour suite runs the store's side of AC2, AC4 to AC8, AC12
// and AC14 to AC16 against the adapter in adapters/journeys.integration.test.ts.
//
// PostgreSQL 15, staging's version, as deploy.integration.test.ts explains.
// Needs Docker, like every *.integration.test.ts: CI's integration job runs
// it, a cloud session cannot.
//
// Each test starts from a quiet database: every journey a test left unended
// is ended, and every message left due is put out of reach as sent, so a
// sweep or a claim here sees only what the test itself put in.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  RACE_ROUNDS,
  RACERS,
  apiPath,
  endTestPool,
  fakeLog,
  fakePush,
  syntheticCredential,
  syntheticEventId,
  syntheticHeartbeat,
  syntheticPosition,
  syntheticUuid,
  type FakeLog,
  type FakePush,
  type SyntheticHeartbeat,
} from '@trygghverdag/test-kit';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { databaseClock } from './adapters/clock.ts';
import { createDatabase, createPool, type Database } from './adapters/db.ts';
import { databaseDeviceAuthenticator, hashCredential } from './adapters/device-credentials.ts';
import { databaseJourneyStore } from './adapters/journeys.ts';
import { migrateDatabase } from './adapters/migrations.ts';
import { databaseWorkerHeartbeats } from './adapters/worker-heartbeats.ts';
import { createApi } from './api.ts';
import { LOST_CONTACT_AFTER_MS } from './domain/journey.ts';
import { CLAIM_LEASE_MS, LOCK_WAIT_LIMIT_MS } from './domain/watchdog.ts';
import { createPushSender } from './modules/alerts/outbox.ts';
import { createWatchdog } from './modules/alerts/watchdog.ts';
import { createHealthService } from './modules/health/service.ts';
import { createJourneyService } from './modules/journeys/service.ts';

/** What Clever Cloud's DEV plan runs; see deploy.integration.test.ts. */
const STAGING_POSTGRES = 'postgres:15-alpine';

/** Enough connections that every racer holds its own. */
const CONNECTIONS = RACERS + 4;

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

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
  // endTestPool: see journeys.integration.test.ts.
  await endTestPool(pool);
  await container?.stop();
});

beforeEach(async () => {
  await connection().query("update journeys set state = 'ENDED' where state <> 'ENDED'");
  await connection().query('update outbox set sent_at = now() where sent_at is null');
  // RG-03 (LOST-07; not in the spec's list, found reading this setup against
  // the escalation): the sweep now also escalates every unresolved alert two
  // minutes old or more, across the whole table. Ending a journey by hand
  // leaves its alert unresolved, so a later test's sweep would escalate an
  // earlier test's alert, and every `escalated: 0` below would depend on how
  // long the file had run. So the leftovers are resolved too, as "I'm home"
  // would have resolved them. Nothing a test asserts about its own rows
  // changes. And every exact sweep result below gains `escalated: 0` (the
  // spec's "Every exact sweep result"): these tests sweep within seconds of
  // an alert opening, never two minutes, so none is escalated.
  await connection().query(
    "update alerts set state = 'RESOLVED', resolved_at = now(), resolution = 'HOME' " +
      "where state <> 'RESOLVED'",
  );
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

/** This URI with a query parameter added: here, a name its sessions show in pg_stat_activity. */
function withParameter(uri: string, name: string, value: string): string {
  const url = new URL(uri);
  url.searchParams.set(name, value);
  return url.toString();
}

/** A pool of its own, named, so a test can see in pg_stat_activity what its sessions wait for. */
function namedPool(applicationName: string, size = 2): pg.Pool {
  return createPool(withParameter(connectionUri(), 'application_name', applicationName), size, {
    lockTimeoutMs: LOCK_WAIT_LIMIT_MS,
  });
}

// ---------------------------------------------------------------------------
// Rows, put in and read back directly. Times are written relative to the
// database's own now(), in the statement that writes them.
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

/**
 * An ACTIVE journey of a new walker, put in directly with `responders`
 * responders: started an hour before now(), and last heard from `silentForMs`
 * before now().
 */
async function silent({
  responders = 2,
  silentForMs = 5 * MINUTE + 10 * SECOND,
}: { responders?: number; silentForMs?: number } = {}) {
  const device = await walker();
  const responderIds: string[] = [];
  for (let i = 0; i < responders; i += 1) {
    responderIds.push(await addUser());
  }
  const journeyId = syntheticUuid();
  await connection().query(
    `insert into journeys (id, walker_id, device_id, state, started_at, last_heartbeat_at)
     values ($1, $2, $3, 'ACTIVE', now() - interval '1 hour',
             now() - ($4::double precision * interval '1 millisecond'))`,
    [journeyId, device.userId, device.deviceId, silentForMs],
  );
  for (const responderId of responderIds) {
    await connection().query(
      'insert into journey_responders (journey_id, responder_id) values ($1, $2)',
      [journeyId, responderId],
    );
  }
  return { device, journeyId, responderIds };
}

const store = () => databaseJourneyStore(database());

/** A silent journey, opened by the real adapter: LOST_CONTACT, its alert, and one unsent LOST_CONTACT message per responder. */
async function lost({ responders = 2 }: { responders?: number } = {}) {
  const journey = await silent({ responders, silentForMs: HOUR });
  const opened = await store().openLostContactAlert({
    journeyId: journey.journeyId,
    afterMs: LOST_CONTACT_AFTER_MS,
  });
  if (opened.outcome !== 'opened') {
    throw new Error(`expected the journey to be opened, but it was ${opened.outcome}`);
  }
  return { ...journey, alertId: opened.alertId, messages: opened.messages };
}

/** A moment as milliseconds since the epoch, in SQL, floored as a Date floors it. */
const MS = (column: string) => `floor(extract(epoch from ${column}) * 1000)::bigint::text`;

async function databaseNowMs(): Promise<number> {
  const result = await connection().query<{ ms: string }>(`select ${MS('now()')} as ms`);
  return Number(result.rows[0]?.ms);
}

const numberOrNull = (ms: string | null | undefined): number | null =>
  ms === null || ms === undefined ? null : Number(ms);

async function journeyOf(journeyId: string) {
  const result = await connection().query<{
    state: string;
    last_ms: string | null;
    ended_ms: string | null;
    end_reason: string | null;
  }>(
    `select state::text as state, ${MS('last_heartbeat_at')} as last_ms,
            ${MS('ended_at')} as ended_ms, end_reason::text as end_reason
       from journeys where id = $1`,
    [journeyId],
  );
  const row = result.rows[0];
  return {
    state: row?.state ?? null,
    lastHeartbeatAt: numberOrNull(row?.last_ms),
    endedAt: numberOrNull(row?.ended_ms),
    endReason: row?.end_reason ?? null,
  };
}

async function stateOf(journeyId: string): Promise<string | null> {
  const result = await connection().query<{ state: string }>(
    'select state::text as state from journeys where id = $1',
    [journeyId],
  );
  return result.rows[0]?.state ?? null;
}

async function alertsOf(journeyId: string) {
  const result = await connection().query<{
    id: string;
    state: string;
    resolved_ms: string | null;
    resolution: string | null;
  }>(
    `select id::text as id, state::text as state, ${MS('resolved_at')} as resolved_ms,
            resolution::text as resolution
       from alerts where journey_id = $1 order by opened_at, id`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    state: row.state,
    resolvedAt: numberOrNull(row.resolved_ms),
    resolution: row.resolution,
  }));
}

async function messagesOf(journeyId: string) {
  const result = await connection().query<{
    message_id: string;
    alert_id: string;
    recipient_id: string;
    kind: string;
    attempts: number;
    created_ms: string;
    next_ms: string;
    next_text: string;
    sent_ms: string | null;
    withdrawn_ms: string | null;
    last_failure: string | null;
  }>(
    `select o.id::text as message_id, o.alert_id::text as alert_id,
            o.recipient_id::text as recipient_id, o.kind::text as kind,
            o.attempts::int as attempts, ${MS('o.created_at')} as created_ms,
            ${MS('o.next_attempt_at')} as next_ms, o.next_attempt_at::text as next_text,
            ${MS('o.sent_at')} as sent_ms, ${MS('o.withdrawn_at')} as withdrawn_ms,
            o.last_failure::text as last_failure
       from outbox o join alerts a on a.id = o.alert_id
      where a.journey_id = $1 order by o.recipient_id, o.kind`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    messageId: row.message_id,
    alertId: row.alert_id,
    recipientId: row.recipient_id,
    kind: row.kind,
    attempts: row.attempts,
    createdAt: Number(row.created_ms),
    nextAttemptAt: Number(row.next_ms),
    /** next_attempt_at as PostgreSQL prints it, to the microsecond. */
    nextAttemptText: row.next_text,
    sentAt: numberOrNull(row.sent_ms),
    withdrawnAt: numberOrNull(row.withdrawn_ms),
    lastFailure: row.last_failure,
  }));
}

async function heartbeatCountOf(journeyId: string): Promise<number> {
  const result = await connection().query<{ n: number }>(
    'select count(*)::int as n from heartbeats where journey_id = $1',
    [journeyId],
  );
  return result.rows[0]?.n ?? Number.NaN;
}

async function positionCountOf(journeyId: string): Promise<number> {
  const result = await connection().query<{ n: number }>(
    `select count(*)::int as n from positions p join heartbeats h on h.id = p.heartbeat_id
      where h.journey_id = $1`,
    [journeyId],
  );
  return result.rows[0]?.n ?? Number.NaN;
}

/** Everything the tables hold of a journey, to compare before and after. */
async function recordOf(journeyId: string) {
  return {
    journey: await journeyOf(journeyId),
    heartbeats: await heartbeatCountOf(journeyId),
    positions: await positionCountOf(journeyId),
    alerts: await alertsOf(journeyId),
    messages: await messagesOf(journeyId),
  };
}

/** A test-only database object, dropped again whatever happens. */
async function withTrigger(create: string[], drop: string[], run: () => Promise<void>) {
  for (const statement of create) {
    await connection().query(statement);
  }
  try {
    await run();
  } finally {
    for (const statement of drop) {
      await connection().query(statement);
    }
  }
}

/** Waits, in short sleeps rather than by a clock, until `check` holds or the attempts run out. */
async function eventually(check: () => Promise<boolean>, attempts = 400): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return check();
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

/** A psql-like session of the test's own: its own connection, outside every pool. */
async function session(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: connectionUri() });
  await client.connect();
  return client;
}

/** A session holding an advisory lock that a test trigger waits for: the gate a held transaction stays behind. */
async function gate() {
  const key = Math.floor(Math.random() * 1_000_000_000);
  const client = await connection().connect();
  await client.query('select pg_advisory_lock($1)', [key]);
  return {
    key,
    open: async () => {
      await client.query('select pg_advisory_unlock_all()');
    },
    end: async () => {
      await client.query('select pg_advisory_unlock_all()');
      client.release();
    },
  };
}

/** Whether a session is waiting for an advisory lock: a held transaction is behind the gate. */
async function someoneAtTheGate(): Promise<boolean> {
  const result = await connection().query<{ n: number }>(
    "select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted",
  );
  return (result.rows[0]?.n ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// The real adapter, the real modules, and the recording fakes at the edge.
// ---------------------------------------------------------------------------

function watchdogFor({
  database: on = database(),
  log = fakeLog(),
}: { database?: Database; log?: FakeLog } = {}) {
  return createWatchdog({
    journeys: databaseJourneyStore(on),
    beats: databaseWorkerHeartbeats(on),
    log,
  });
}

function senderFor({
  push = fakePush(),
  log = fakeLog(),
}: { push?: FakePush; log?: FakeLog } = {}) {
  return createPushSender({ outbox: store(), push, log });
}

function realApi({
  database: on = database(),
  log = fakeLog(),
}: { database?: Database; log?: FakeLog } = {}) {
  const clock = databaseClock(on);
  return createApi({
    health: createHealthService({ clock, heartbeats: databaseWorkerHeartbeats(on) }),
    journeys: createJourneyService({ clock, journeys: databaseJourneyStore(on), log }),
    devices: databaseDeviceAuthenticator(on),
    // RG-03 (LOST-06, the spec's "Existing assertions that change by
    // design"): `acknowledgements` added because "I'm on it" (D-114) made it
    // part of what the API needs. These tests acknowledge nothing, so it
    // rejects; they never call it, and nothing they assert changes.
    acknowledgements: {
      acknowledge: () => Promise.reject(new Error('these tests acknowledge nothing')),
    },
  });
}

async function post(
  api: ReturnType<typeof realApi>,
  credential: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await api.request(
    apiPath(route),
    body === undefined
      ? { method: 'POST', headers: { authorization: `Bearer ${credential}` } }
      : {
          method: 'POST',
          headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const text = await response.text();
  return { status: response.status, body: parsedOrNull(text) };
}

function parsedOrNull(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const home = (api: ReturnType<typeof realApi>, credential: string, journeyId: string) =>
  post(api, credential, `journeys/${journeyId}/home`);

const recipientsOf = (messages: readonly { recipientId: string }[]) =>
  messages.map(({ recipientId }) => recipientId).sort();

const ofKind = <T extends { kind: string }>(messages: readonly T[], kind: string): T[] =>
  messages.filter((message) => message.kind === kind);

/** Where in the port's record this responder's message of this kind first appears, or -1. */
const indexIn = (
  messages: readonly { recipientId: string; kind: string }[],
  recipientId: string,
  kind: string,
) => messages.findIndex((m) => m.recipientId === recipientId && m.kind === kind);

/**
 * A journey started through the API with these many responders, a heartbeat
 * sent, and then silent: its start and last contact moved back 5 min 1 s,
 * relative to the database's own now(), in one transaction (as LOST-02-AC1
 * at L3 does).
 */
async function startedAndSilent(api: ReturnType<typeof realApi>, responders: number) {
  const device = await walker();
  const responderIds: string[] = [];
  for (let i = 0; i < responders; i += 1) {
    responderIds.push(await addUser());
  }
  const started = await post(api, device.credential, 'journeys', { responderIds });
  expect(started.status).toBe(201);
  const journeyId = String(started.body?.['journeyId']);
  const sent = await post(api, device.credential, 'heartbeats', syntheticHeartbeat({ journeyId }));
  expect(sent.status).toBe(200);
  const client = await connection().connect();
  try {
    await client.query('begin');
    await client.query(
      "update heartbeats set received_at = now() - interval '5 minutes 1 second' where journey_id = $1",
      [journeyId],
    );
    await client.query(
      `update journeys set started_at = now() - interval '15 minutes',
              last_heartbeat_at = now() - interval '5 minutes 1 second' where id = $1`,
      [journeyId],
    );
    await client.query('commit');
  } finally {
    client.release();
  }
  return { device, journeyId, responderIds };
}

// ---------------------------------------------------------------------------
// LOST-03-AC1 and AC14: the flows, on the real tables.
// ---------------------------------------------------------------------------

describe('LOST-03: back in contact, on the real tables', () => {
  test.each([3, 1])(
    'LOST-03-AC1: a journey started through the API with %i responder(s), silent past five minutes and alerted by the real watchdog and sender, is brought back by the phone’s next heartbeat: 200 RECORDED, ACTIVE, its alert RESOLVED between two readings of now() with resolution BACK_IN_CONTACT; the sender then hands each responder one BACK_IN_CONTACT after their LOST_CONTACT, the walker none; another sweep and delivery add nothing',
    async (responders) => {
      const api = realApi();
      const push = fakePush();
      const log = fakeLog();
      const { device, journeyId, responderIds } = await startedAndSilent(api, responders);

      expect((await watchdogFor({ log }).sweep()).opened).toBe(1);
      await senderFor({ push, log }).deliverDue();
      expect(recipientsOf(ofKind(push.accepted, 'LOST_CONTACT'))).toEqual([...responderIds].sort());

      const before = await databaseNowMs();
      const answer = await post(
        api,
        device.credential,
        'heartbeats',
        syntheticHeartbeat({ journeyId }),
      );
      const after = await databaseNowMs();

      expect(answer).toEqual({ status: 200, body: { outcome: 'RECORDED' } });
      expect(await stateOf(journeyId)).toBe('ACTIVE');
      const [alert, ...others] = await alertsOf(journeyId);
      expect(others).toEqual([]);
      expect(alert).toMatchObject({ state: 'RESOLVED', resolution: 'BACK_IN_CONTACT' });
      expect(alert?.resolvedAt).toBeGreaterThanOrEqual(before);
      expect(alert?.resolvedAt).toBeLessThanOrEqual(after);

      await senderFor({ push, log }).deliverDue();
      expect(recipientsOf(ofKind(push.accepted, 'BACK_IN_CONTACT'))).toEqual(
        [...responderIds].sort(),
      );
      for (const responderId of responderIds) {
        expect(indexIn(push.messages, responderId, 'LOST_CONTACT')).toBeLessThan(
          indexIn(push.messages, responderId, 'BACK_IN_CONTACT'),
        );
      }
      expect(recipientsOf(push.messages)).not.toContain(device.userId);

      const handedOver = push.messages.length;
      expect((await watchdogFor({ log }).sweep()).opened).toBe(0);
      await senderFor({ push, log }).deliverDue();
      expect(push.messages).toHaveLength(handedOver);
      expect(log.events).toEqual([]);
    },
  );
});

describe('SM-04: a queued "I’m home" after an alert, on the real tables', () => {
  test('LOST-03-AC14: "I’m home" through the API after the alert, before any heartbeat: 200 ENDED; J ENDED, end reason HOME, ended between two readings of now(); the alert RESOLVED with resolution HOME; the sender hands each responder one HOME after their LOST_CONTACT, the walker none; heartbeats after it are 409 and store nothing; no sweep alerts J again, and the walker starts a new journey (201)', async () => {
    const api = realApi();
    const push = fakePush();
    const { device, journeyId, responderIds } = await startedAndSilent(api, 3);
    expect((await watchdogFor().sweep()).opened).toBe(1);
    await senderFor({ push }).deliverDue();
    const heartbeats = await heartbeatCountOf(journeyId);

    const before = await databaseNowMs();
    const answer = await home(api, device.credential, journeyId);
    const after = await databaseNowMs();

    expect(answer).toEqual({ status: 200, body: { outcome: 'ENDED' } });
    const journey = await journeyOf(journeyId);
    expect(journey).toMatchObject({ state: 'ENDED', endReason: 'HOME' });
    expect(journey.endedAt).toBeGreaterThanOrEqual(before);
    expect(journey.endedAt).toBeLessThanOrEqual(after);
    expect(await alertsOf(journeyId)).toEqual([
      expect.objectContaining({
        state: 'RESOLVED',
        resolution: 'HOME',
        resolvedAt: journey.endedAt,
      }),
    ]);

    await senderFor({ push }).deliverDue();
    expect(recipientsOf(ofKind(push.accepted, 'HOME'))).toEqual([...responderIds].sort());
    for (const responderId of responderIds) {
      expect(indexIn(push.messages, responderId, 'LOST_CONTACT')).toBeLessThan(
        indexIn(push.messages, responderId, 'HOME'),
      );
    }
    expect(recipientsOf(push.messages)).not.toContain(device.userId);

    const queued = await post(
      api,
      device.credential,
      'heartbeats',
      syntheticHeartbeat({ journeyId }),
    );
    expect(queued.status).toBe(409);
    expect(queued.body?.['code']).toBe('JOURNEY_ENDED');
    expect(await heartbeatCountOf(journeyId)).toBe(heartbeats);
    expect((await watchdogFor().sweep()).opened).toBe(0);
    expect(await alertsOf(journeyId)).toHaveLength(1);
    const again = await post(api, device.credential, 'journeys', { responderIds });
    expect(again.status).toBe(201);
  });

  test('LOST-03-AC14: in the other order, a queued heartbeat first: J comes back in contact, BACK_IN_CONTACT to each, and "I’m home" then ends J from ACTIVE: 200 ENDED, no further message, the alert as the heartbeat left it', async () => {
    const api = realApi();
    const push = fakePush();
    const { device, journeyId, responderIds } = await startedAndSilent(api, 2);
    expect((await watchdogFor().sweep()).opened).toBe(1);
    await senderFor({ push }).deliverDue();

    const beat = await post(
      api,
      device.credential,
      'heartbeats',
      syntheticHeartbeat({ journeyId }),
    );
    expect(beat.status).toBe(200);
    await senderFor({ push }).deliverDue();
    expect(recipientsOf(ofKind(push.accepted, 'BACK_IN_CONTACT'))).toEqual(
      [...responderIds].sort(),
    );
    const alerts = await alertsOf(journeyId);
    const messages = await messagesOf(journeyId);

    const answer = await home(api, device.credential, journeyId);

    expect(answer).toEqual({ status: 200, body: { outcome: 'ENDED' } });
    expect(await journeyOf(journeyId)).toMatchObject({ state: 'ENDED', endReason: 'HOME' });
    expect(await alertsOf(journeyId)).toEqual(alerts);
    expect(await messagesOf(journeyId)).toEqual(messages);
    await senderFor({ push }).deliverDue();
    expect(ofKind(push.messages, 'HOME')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LOST-03-AC6 to AC9: what the tables hold.
// ---------------------------------------------------------------------------

/** An outbox message put in directly; every column given, so no default is relied on. */
function insertMessage({
  alertId,
  recipientId,
  kind,
}: {
  alertId: string;
  recipientId: string;
  kind: string;
}) {
  return connection().query(
    `insert into outbox (id, alert_id, recipient_id, kind, created_at, attempts,
                         next_attempt_at, sent_at, last_failure)
     values ($1, $2, $3, $4, now(), 0, now(), null, null)`,
    [syntheticUuid(), alertId, recipientId, kind],
  );
}

describe('LOST-03: the database holds one stand-down per responder, and the times', () => {
  test('LOST-03-AC6: the database itself refuses a second message of the same kind for the same alert and recipient, for each stand-down kind; another recipient, or another kind, is taken', async () => {
    const { alertId, responderIds } = await lost({ responders: 2 });
    const [first = '', second = ''] = responderIds;

    for (const kind of ['BACK_IN_CONTACT', 'HOME']) {
      await expect(
        insertMessage({ alertId, recipientId: first, kind }),
        kind,
      ).resolves.toBeDefined();
      await expect(
        insertMessage({ alertId, recipientId: first, kind }),
        kind,
      ).rejects.toMatchObject({
        code: '23505',
      });
      await expect(
        insertMessage({ alertId, recipientId: second, kind }),
        kind,
      ).resolves.toBeDefined();
    }
  });

  test('LOST-03-AC7: while another session holds R2’s lost-contact message as a claim in progress would — one more attempt, leased 30 s, not committed — and a third holds R1’s as a mark sending it would, the heartbeat that brings J back waits for them; once they commit, within the API’s lock limit, R2’s message is withdrawn with the attempt the claim counted, R1’s, sent meanwhile, is not withdrawn, and R2’s stand-down is held until the lease the claim set (AC8)', async () => {
    const { journeyId, alertId, responderIds, messages } = await lost({ responders: 2 });
    const [r1 = '', r2 = ''] = responderIds;
    const messageOf = (recipientId: string) =>
      messages.find((message) => message.recipientId === recipientId)?.messageId ?? '';
    const tag = 'lost03_ac7_heartbeat';
    const heartbeatPool = namedPool(tag);
    const claim = await session();
    const mark = await session();
    try {
      await claim.query('begin');
      const leased = await claim.query<{ next: string }>(
        `update outbox set attempts = attempts + 1, next_attempt_at = now() + interval '30 seconds'
          where id = $1 returning next_attempt_at::text as next`,
        [messageOf(r2)],
      );
      await mark.query('begin');
      await mark.query('update outbox set sent_at = coalesce(sent_at, now()) where id = $1', [
        messageOf(r1),
      ]);
      const receivedAt = new Date(await databaseNowMs());
      let answer: unknown;
      const recording = databaseJourneyStore(createDatabase(heartbeatPool))
        .recordHeartbeat({
          journeyId,
          eventId: syntheticEventId(),
          receivedAt,
          batteryLevel: null,
          position: null,
        })
        .then((result) => {
          answer = result;
        });
      recording.catch(() => undefined);

      // Waiting on the outbox rows, as pg_stat_activity shows it: not merely slow.
      expect(await eventually(async () => (await waitingOnALock(tag)) === 1)).toBe(true);
      expect(answer).toBeUndefined();

      await mark.query('commit');
      await claim.query('commit');
      await recording;

      expect(answer).toMatchObject({ outcome: 'back_in_contact', alertId });
      const stored = await messagesOf(journeyId);
      const lostContact = (recipientId: string) =>
        stored.find((m) => m.recipientId === recipientId && m.kind === 'LOST_CONTACT');
      const standDown = (recipientId: string) =>
        stored.find((m) => m.recipientId === recipientId && m.kind === 'BACK_IN_CONTACT');
      expect(lostContact(r2)).toMatchObject({ attempts: 1, sentAt: null });
      expect(lostContact(r2)?.withdrawnAt).not.toBeNull();
      expect(lostContact(r2)?.nextAttemptText).toBe(leased.rows[0]?.next);
      expect(lostContact(r1)?.sentAt).not.toBeNull();
      expect(lostContact(r1)?.withdrawnAt).toBeNull();
      expect(standDown(r2)?.nextAttemptText).toBe(leased.rows[0]?.next);
      const [alert] = await alertsOf(journeyId);
      expect(standDown(r1)?.nextAttemptAt).toBe(alert?.resolvedAt);
    } finally {
      await claim.query('rollback').catch(() => undefined);
      await mark.query('rollback').catch(() => undefined);
      await claim.end();
      await mark.end();
      await endTestPool(heartbeatPool);
    }
  }, 30_000);

  test('LOST-03-AC8: for a lost-contact message claimed by the real claim and not marked, the stand-down’s next_attempt_at is, to the microsecond, the lease end the withdrawal found on it; one never claimed is due at the resolution’s now()', async () => {
    const { journeyId, responderIds, messages } = await lost({ responders: 2 });
    // Only this alert's messages are due: every other test's are out of reach.
    const claim = await store().claimDue({ limit: 1, leaseMs: CLAIM_LEASE_MS });
    const [claimed] = claim.messages.filter((m) =>
      messages.some(({ messageId }) => messageId === m.messageId),
    );
    if (claimed === undefined) {
      throw new Error('expected the claim to take one of this alert’s messages');
    }
    const never = responderIds.find((id) => id !== claimed.recipientId) ?? '';

    const result = await store().recordHeartbeat({
      journeyId,
      eventId: syntheticEventId(),
      receivedAt: new Date(await databaseNowMs()),
      batteryLevel: null,
      position: null,
    });

    expect(result.outcome).toBe('back_in_contact');
    const stored = await messagesOf(journeyId);
    const find = (recipientId: string, kind: string) =>
      stored.find((m) => m.recipientId === recipientId && m.kind === kind);
    expect(find(claimed.recipientId, 'BACK_IN_CONTACT')?.nextAttemptText).toBe(
      find(claimed.recipientId, 'LOST_CONTACT')?.nextAttemptText,
    );
    const [alert] = await alertsOf(journeyId);
    expect(find(never, 'BACK_IN_CONTACT')?.nextAttemptAt).toBe(alert?.resolvedAt);
  });

  test('LOST-03-AC9: alerts gain resolved_at and resolution, outbox withdrawn_at, journeys ended_at and end_reason; no column of alerts, outbox or journeys holds a coordinate, an accuracy, a phone time, a battery level or a name; and the only columns named like a coordinate, in every table, are still positions.latitude and positions.longitude (information_schema)', async () => {
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
    const journeys = await columnsOf('journeys');
    const coordinates = await connection().query<{ found: string }>(
      `select table_schema || '.' || table_name || '.' || column_name as found
         from information_schema.columns
        where table_schema not in ('pg_catalog', 'information_schema')
          and column_name ~* '(lat|lng|lon|coords|position|location)'
        order by 1`,
    );

    expect(alerts).toEqual(expect.arrayContaining(['resolved_at', 'resolution']));
    expect(outbox).toEqual(expect.arrayContaining(['withdrawn_at']));
    expect(journeys).toEqual(expect.arrayContaining(['ended_at', 'end_reason']));
    expect(
      [...alerts, ...outbox, ...journeys].filter((column) =>
        /lat|lng|lon|coord|position|location|accuracy|recorded|battery|phone|name/i.test(column),
      ),
    ).toEqual([]);
    expect(coordinates.rows.map(({ found }) => found)).toEqual([
      'public.positions.latitude',
      'public.positions.longitude',
    ]);
  });

  test('LOST-03-AC13: resolved_at, every withdrawn_at, every stand-down’s created_at, and ended_at lie between two readings of now() taken before and after the call; phone times hours ahead or behind change neither whether contact is back nor those times (REL-01)', async () => {
    const api = realApi();
    for (const hours of [9, -9]) {
      const { device, journeyId } = await lost({ responders: 2 });
      const now = await databaseNowMs();
      const body = syntheticHeartbeat({
        journeyId,
        position: syntheticPosition({ recordedAt: new Date(now + hours * HOUR) }),
      });

      const before = await databaseNowMs();
      const answer = await post(api, device.credential, 'heartbeats', body);
      const after = await databaseNowMs();

      expect(answer.status, String(hours)).toBe(200);
      expect(await stateOf(journeyId), String(hours)).toBe('ACTIVE');
      const [alert] = await alertsOf(journeyId);
      const messages = await messagesOf(journeyId);
      const times = [
        alert?.resolvedAt,
        ...ofKind(messages, 'LOST_CONTACT').map(({ withdrawnAt }) => withdrawnAt),
        ...ofKind(messages, 'BACK_IN_CONTACT').map(({ createdAt }) => createdAt),
      ];
      expect(times, String(hours)).toHaveLength(5);
      for (const time of times) {
        expect(time, String(hours)).toBeGreaterThanOrEqual(before);
        expect(time, String(hours)).toBeLessThanOrEqual(after);
      }
    }

    const { device, journeyId } = await lost({ responders: 2 });
    const before = await databaseNowMs();
    const ended = await home(api, device.credential, journeyId);
    const after = await databaseNowMs();

    expect(ended.status).toBe(200);
    const [alert] = await alertsOf(journeyId);
    const messages = await messagesOf(journeyId);
    const times = [
      (await journeyOf(journeyId)).endedAt,
      alert?.resolvedAt,
      ...ofKind(messages, 'LOST_CONTACT').map(({ withdrawnAt }) => withdrawnAt),
      ...ofKind(messages, 'HOME').map(({ createdAt }) => createdAt),
    ];
    expect(times).toHaveLength(6);
    for (const time of times) {
      expect(time).toBeGreaterThanOrEqual(before);
      expect(time).toBeLessThanOrEqual(after);
    }
  });
});

// ---------------------------------------------------------------------------
// LOST-03-AC10 and AC17: all or nothing (AR-05).
// ---------------------------------------------------------------------------

/** A test trigger refusing a second stand-down of `kind` for an alert: the moment a missing transaction would show. */
function refuseASecondStandDown(kind: string) {
  const name = `lost03_refuse_a_second_${kind.toLowerCase()}`;
  return {
    create: [
      `create function ${name}() returns trigger language plpgsql as $$
         begin
           if new.kind::text = '${kind}'
              and exists (select 1 from outbox where alert_id = new.alert_id and kind = new.kind) then
             raise exception 'a second stand-down refused by a test trigger' using errcode = 'P0001';
           end if;
           return new;
         end
       $$`,
      `create trigger ${name} before insert on outbox for each row execute function ${name}()`,
    ],
    drop: [`drop trigger if exists ${name} on outbox`, `drop function if exists ${name}()`],
  };
}

describe('LOST-03 and AR-05: the heartbeat, the move, the resolution, the withdrawals and every stand-down are one transaction', () => {
  test('LOST-03-AC10: with a test trigger refusing the second responder’s stand-down, a fresh heartbeat for LOST_CONTACT J through the module fails with one heartbeat_failed line, stage store and the SQLSTATE, and nothing changes: no heartbeat or position, last contact as it was, J LOST_CONTACT, its alert OPEN, nothing withdrawn, no stand-down; without the trigger, the same heartbeat is RECORDED, not DUPLICATE, and does all of AC1’s work', async () => {
    const { device, journeyId, responderIds } = await lost({ responders: 3 });
    const log = fakeLog();
    const module = createJourneyService({
      clock: databaseClock(database()),
      journeys: store(),
      log,
    });
    const heartbeat = syntheticHeartbeat({ journeyId, position: syntheticPosition() });
    const call = { walkerId: device.userId, deviceId: device.deviceId, heartbeat };
    const before = await recordOf(journeyId);
    const { create, drop } = refuseASecondStandDown('BACK_IN_CONTACT');

    await withTrigger(create, drop, async () => {
      await expect(module.heartbeat(call)).rejects.toThrow();

      expect(log.events).toEqual([{ event: 'heartbeat_failed', stage: 'store', code: 'P0001' }]);
      expect(await recordOf(journeyId)).toEqual(before);
      expect(before.journey.state).toBe('LOST_CONTACT');
      expect(before.alerts.map(({ state }) => state)).toEqual(['OPEN']);
      expect(before.messages.map(({ withdrawnAt }) => withdrawnAt)).toEqual([null, null, null]);
    });

    expect(await module.heartbeat(call)).toEqual({ type: 'recorded' });
    expect(await stateOf(journeyId)).toBe('ACTIVE');
    expect(await heartbeatCountOf(journeyId)).toBe(1);
    expect(await positionCountOf(journeyId)).toBe(1);
    expect((await alertsOf(journeyId)).map(({ state }) => state)).toEqual(['RESOLVED']);
    const messages = await messagesOf(journeyId);
    expect(recipientsOf(ofKind(messages, 'BACK_IN_CONTACT'))).toEqual([...responderIds].sort());
    expect(ofKind(messages, 'LOST_CONTACT').every(({ withdrawnAt }) => withdrawnAt !== null)).toBe(
      true,
    );
  });

  test('LOST-03-AC17: with a test trigger refusing the second HOME message, "I’m home" for LOST_CONTACT J is 500 with one home_failed line, and nothing changes: J LOST_CONTACT, its alert OPEN, nothing withdrawn, no HOME message; without the trigger, the same request does all of AC14’s work', async () => {
    const { device, journeyId, responderIds } = await lost({ responders: 3 });
    const log = fakeLog();
    const api = realApi({ log });
    const before = await recordOf(journeyId);
    const { create, drop } = refuseASecondStandDown('HOME');

    await withTrigger(create, drop, async () => {
      const failed = await home(api, device.credential, journeyId);

      expect(failed.status).toBe(500);
      expect(log.events).toEqual([{ event: 'home_failed', stage: 'store', code: 'P0001' }]);
      expect(await recordOf(journeyId)).toEqual(before);
    });

    const again = await home(api, device.credential, journeyId);

    expect(again).toEqual({ status: 200, body: { outcome: 'ENDED' } });
    expect(await journeyOf(journeyId)).toMatchObject({ state: 'ENDED', endReason: 'HOME' });
    expect((await alertsOf(journeyId)).map(({ resolution }) => resolution)).toEqual(['HOME']);
    expect(recipientsOf(ofKind(await messagesOf(journeyId), 'HOME'))).toEqual(
      [...responderIds].sort(),
    );
  });

  // Review loop 1 (the spec's item 1c; D-112 amended; LOST-02-AC12): the
  // open's withdrawal of earlier stand-downs is part of the open's one
  // transaction, so an open that rolls back withdraws nothing.
  test('LOST-03-AC8: an open rolled back by a test-only trigger on its second message withdraws no earlier stand-down', async () => {
    const { journeyId, responderIds } = await lost({ responders: 2 });
    const back = await store().recordHeartbeat({
      journeyId,
      eventId: syntheticEventId(),
      receivedAt: new Date(await databaseNowMs()),
      batteryLevel: null,
      position: null,
    });
    expect(back.outcome).toBe('back_in_contact');
    // Silent again, ten minutes, put there directly: overdue for A2.
    await connection().query(
      "update journeys set last_heartbeat_at = now() - interval '10 minutes' where id = $1",
      [journeyId],
    );
    const standDowns = () =>
      messagesOf(journeyId).then((messages) => ofKind(messages, 'BACK_IN_CONTACT'));
    expect(recipientsOf(await standDowns())).toEqual([...responderIds].sort());
    expect((await standDowns()).map(({ withdrawnAt }) => withdrawnAt)).toEqual([null, null]);
    const before = await recordOf(journeyId);
    const { create, drop } = refuseASecondStandDown('LOST_CONTACT');

    await withTrigger(create, drop, async () => {
      await expect(
        store().openLostContactAlert({ journeyId, afterMs: LOST_CONTACT_AFTER_MS }),
      ).rejects.toThrow();

      expect(await recordOf(journeyId)).toEqual(before);
    });
    expect(before.journey.state).toBe('ACTIVE');
    expect(before.alerts.map(({ state }) => state)).toEqual(['RESOLVED']);

    // Control: without the trigger, the same open opens A2 and withdraws
    // both stand-downs, at its own now().
    const opened = await store().openLostContactAlert({
      journeyId,
      afterMs: LOST_CONTACT_AFTER_MS,
    });
    if (opened.outcome !== 'opened') {
      throw new Error(`expected the journey to be opened again, but it was ${opened.outcome}`);
    }
    const openedAt = await connection().query<{ ms: string }>(
      `select ${MS('opened_at')} as ms from alerts where id = $1`,
      [opened.alertId],
    );
    const openedMs = Number(openedAt.rows[0]?.ms);
    expect((await standDowns()).map(({ withdrawnAt }) => withdrawnAt)).toEqual([
      openedMs,
      openedMs,
    ]);
  });
});

// ---------------------------------------------------------------------------
// LOST-03-AC11, AC12 and AC17: meeting on the row.
// ---------------------------------------------------------------------------

/** A trigger that holds a transaction open behind a gate, after `event` on `table`, when `condition` holds. */
function holdBehind(key: number, table: string, event: string, condition = 'true') {
  const name = `lost03_hold_${table}_${event}`;
  return {
    create: [
      `create function ${name}() returns trigger language plpgsql as $$
         begin
           perform pg_advisory_xact_lock(${String(key)});
           return new;
         end
       $$`,
      `create trigger ${name} after ${event} on ${table} for each row when (${condition})
         execute function ${name}()`,
    ],
    drop: [`drop trigger if exists ${name} on ${table}`, `drop function if exists ${name}()`],
  };
}

describe('LOST-03 and SM-09: a heartbeat and the watchdog’s open meet on the row', () => {
  test('LOST-03-AC11: a heartbeat’s transaction holding J’s row as a sweep runs: the sweep skips J; once it commits, J is ACTIVE and not overdue, with no alert and no message, and the next sweep opens nothing', async () => {
    const { journeyId } = await silent();
    const held = await gate();
    try {
      const { create, drop } = holdBehind(held.key, 'heartbeats', 'insert');
      await withTrigger(create, drop, async () => {
        const recording = store().recordHeartbeat({
          journeyId,
          eventId: syntheticEventId(),
          receivedAt: new Date(await databaseNowMs()),
          batteryLevel: null,
          position: null,
        });
        recording.catch(() => undefined);
        try {
          expect(await eventually(someoneAtTheGate)).toBe(true);
          expect(await watchdogFor().sweep()).toEqual({
            ok: true,
            opened: 0,
            escalated: 0,
            stuck: 0,
          });
        } finally {
          await held.open();
        }
        expect(await recording).toEqual({ outcome: 'recorded' });
      });
    } finally {
      await held.end();
    }

    expect(await stateOf(journeyId)).toBe('ACTIVE');
    expect(await alertsOf(journeyId)).toEqual([]);
    expect(await messagesOf(journeyId)).toEqual([]);
    expect(await watchdogFor().sweep()).toEqual({ ok: true, opened: 0, escalated: 0, stuck: 0 });
  });

  test('LOST-03-AC11: the sweep’s open holding J’s row before commit as a heartbeat for J arrives: the heartbeat waits for the row (pg_stat_activity), then brings J back: the alert RESOLVED, the lost-contact messages withdrawn, one BACK_IN_CONTACT per responder; J ACTIVE and not overdue, and the next sweep opens nothing', async () => {
    const { journeyId, responderIds } = await silent({ responders: 2 });
    const tag = 'lost03_ac11_heartbeat';
    const heartbeatPool = namedPool(tag, 1);
    const held = await gate();
    try {
      const { create, drop } = holdBehind(held.key, 'alerts', 'insert');
      await withTrigger(create, drop, async () => {
        const sweeping = watchdogFor().sweep();
        sweeping.catch(() => undefined);
        try {
          expect(await eventually(someoneAtTheGate)).toBe(true);
          const recording = databaseJourneyStore(createDatabase(heartbeatPool)).recordHeartbeat({
            journeyId,
            eventId: syntheticEventId(),
            receivedAt: new Date(await databaseNowMs()),
            batteryLevel: null,
            position: null,
          });
          recording.catch(() => undefined);
          expect(await eventually(async () => (await waitingOnALock(tag)) === 1)).toBe(true);

          await held.open();
          expect((await sweeping).opened).toBe(1);
          expect(await recording).toMatchObject({ outcome: 'back_in_contact' });
        } finally {
          await held.open();
        }
      });
    } finally {
      await held.end();
      await endTestPool(heartbeatPool);
    }

    expect(await stateOf(journeyId)).toBe('ACTIVE');
    expect((await alertsOf(journeyId)).map(({ state }) => state)).toEqual(['RESOLVED']);
    const messages = await messagesOf(journeyId);
    expect(ofKind(messages, 'LOST_CONTACT').every(({ withdrawnAt }) => withdrawnAt !== null)).toBe(
      true,
    );
    expect(recipientsOf(ofKind(messages, 'BACK_IN_CONTACT'))).toEqual([...responderIds].sort());
    expect(await watchdogFor().sweep()).toEqual({ ok: true, opened: 0, escalated: 0, stuck: 0 });
  }, 30_000);

  test(`LOST-03-AC11: a heartbeat and two sweepers starting at the same moment on separate connections, ${String(RACE_ROUNDS)} rounds and more: every round ends with J ACTIVE and not overdue, either with no alert and no message, or with its one alert RESOLVED and one BACK_IN_CONTACT per responder; never J LOST_CONTACT, never ACTIVE beside an unresolved alert, never more than one alert`, async () => {
    const outcomes = new Set<string>();
    for (let round = 0; round < 2 * RACE_ROUNDS; round += 1) {
      const at = `round ${String(round)}`;
      const { journeyId, responderIds } = await silent({ responders: 2 });
      const receivedAt = new Date(await databaseNowMs());

      const [swept, other, recorded] = await Promise.all([
        watchdogFor().sweep(),
        watchdogFor().sweep(),
        store().recordHeartbeat({
          journeyId,
          eventId: syntheticEventId(),
          receivedAt,
          batteryLevel: null,
          position: null,
        }),
      ]);

      expect([swept.ok, other.ok], at).toEqual([true, true]);
      expect(await stateOf(journeyId), at).toBe('ACTIVE');
      const alerts = await alertsOf(journeyId);
      expect(alerts.length, at).toBeLessThanOrEqual(1);
      expect(
        alerts.filter(({ state }) => state !== 'RESOLVED'),
        at,
      ).toEqual([]);
      const standDowns = ofKind(await messagesOf(journeyId), 'BACK_IN_CONTACT');
      expect(recipientsOf(standDowns), at).toEqual(
        alerts.length === 1 ? [...responderIds].sort() : [],
      );
      expect(recorded.outcome, at).toBe(alerts.length === 1 ? 'back_in_contact' : 'recorded');
      expect((await watchdogFor().sweep()).opened, at).toBe(0);
      outcomes.add(alerts.length === 1 ? 'open first' : 'heartbeat first');
      await connection().query("update journeys set state = 'ENDED' where id = $1", [journeyId]);
    }
    // Which orders the rounds fell into is the database's to decide; both are allowed.
    expect(outcomes.size).toBeGreaterThanOrEqual(1);
  }, 120_000);
});

describe('LOST-03 and SM-08: heartbeats that race resolve the alert once', () => {
  test(`LOST-03-AC12: ${String(RACERS)} different fresh heartbeats for J through the API at once, on separate connections, ${String(RACE_ROUNDS)} times over: every one 200 RECORDED and stored; one resolution and one BACK_IN_CONTACT per responder; the first, sent again, is DUPLICATE and writes nothing`, async () => {
    const api = realApi();
    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const at = `round ${String(round)}`;
      const { device, journeyId, responderIds } = await lost({ responders: 2 });
      const bodies = Array.from({ length: RACERS }, () =>
        syntheticHeartbeat({ journeyId, position: null }),
      );

      const answers = await Promise.all(
        bodies.map((body) => post(api, device.credential, 'heartbeats', body)),
      );

      expect(answers, at).toEqual(
        bodies.map(() => ({ status: 200, body: { outcome: 'RECORDED' } })),
      );
      expect(await heartbeatCountOf(journeyId), at).toBe(RACERS);
      expect(await stateOf(journeyId), at).toBe('ACTIVE');
      expect(
        (await alertsOf(journeyId)).map(({ state }) => state),
        at,
      ).toEqual(['RESOLVED']);
      const messages = await messagesOf(journeyId);
      expect(recipientsOf(ofKind(messages, 'BACK_IN_CONTACT')), at).toEqual(
        [...responderIds].sort(),
      );

      const [first] = bodies as [SyntheticHeartbeat];
      const again = await post(api, device.credential, 'heartbeats', first);
      expect(again, at).toEqual({ status: 200, body: { outcome: 'DUPLICATE' } });
      expect(await messagesOf(journeyId), at).toEqual(messages);
    }
  }, 120_000);
});

describe('SM-04 and SM-09: "I’m home" meets the watchdog and the heartbeat on the row', () => {
  test('LOST-03-AC17: "I’m home" holding J’s row as a sweep runs: the sweep skips J, and J is ENDED with no alert', async () => {
    const { device, journeyId } = await silent();
    const held = await gate();
    try {
      const { create, drop } = holdBehind(held.key, 'journeys', 'update', "new.state = 'ENDED'");
      await withTrigger(create, drop, async () => {
        const ending = home(realApi(), device.credential, journeyId);
        ending.catch(() => undefined);
        try {
          expect(await eventually(someoneAtTheGate)).toBe(true);
          expect(await watchdogFor().sweep()).toEqual({
            ok: true,
            opened: 0,
            escalated: 0,
            stuck: 0,
          });
        } finally {
          await held.open();
        }
        expect(await ending).toEqual({ status: 200, body: { outcome: 'ENDED' } });
      });
    } finally {
      await held.end();
    }

    expect(await journeyOf(journeyId)).toMatchObject({ state: 'ENDED', endReason: 'HOME' });
    expect(await alertsOf(journeyId)).toEqual([]);
    expect(await watchdogFor().sweep()).toEqual({ ok: true, opened: 0, escalated: 0, stuck: 0 });
  }, 30_000);

  test('LOST-03-AC17: the sweep’s open holding J’s row before commit as "I’m home" arrives: "I’m home" waits (pg_stat_activity), then does SM-04’s work: J ENDED, the alert RESOLVED with resolution HOME, a HOME message per responder, the unsent lost-contact messages withdrawn', async () => {
    const { device, journeyId, responderIds } = await silent({ responders: 2 });
    const tag = 'lost03_ac17_home';
    const homePool = namedPool(tag);
    const held = await gate();
    try {
      const { create, drop } = holdBehind(held.key, 'alerts', 'insert');
      await withTrigger(create, drop, async () => {
        const sweeping = watchdogFor().sweep();
        sweeping.catch(() => undefined);
        try {
          expect(await eventually(someoneAtTheGate)).toBe(true);
          const ending = home(
            realApi({ database: createDatabase(homePool) }),
            device.credential,
            journeyId,
          );
          ending.catch(() => undefined);
          expect(await eventually(async () => (await waitingOnALock(tag)) === 1)).toBe(true);

          await held.open();
          expect((await sweeping).opened).toBe(1);
          expect(await ending).toEqual({ status: 200, body: { outcome: 'ENDED' } });
        } finally {
          await held.open();
        }
      });
    } finally {
      await held.end();
      await endTestPool(homePool);
    }

    expect(await journeyOf(journeyId)).toMatchObject({ state: 'ENDED', endReason: 'HOME' });
    expect((await alertsOf(journeyId)).map(({ state, resolution }) => [state, resolution])).toEqual(
      [['RESOLVED', 'HOME']],
    );
    const messages = await messagesOf(journeyId);
    expect(recipientsOf(ofKind(messages, 'HOME'))).toEqual([...responderIds].sort());
    expect(ofKind(messages, 'LOST_CONTACT').every(({ withdrawnAt }) => withdrawnAt !== null)).toBe(
      true,
    );
  }, 30_000);

  test.each(['heartbeat first', '"I’m home" first'] as const)(
    'LOST-03-AC17: "I’m home" and a fresh heartbeat meet on LOST_CONTACT J’s row, %s: heartbeat first gives BACK_IN_CONTACT to each, then ENDED with no HOME; "I’m home" first gives HOME to each, and the heartbeat is 409 JOURNEY_ENDED and stores nothing; either way one resolution and one stand-down per responder',
    async (order) => {
      const { device, journeyId, responderIds } = await lost({ responders: 2 });
      const heartbeatPool = namedPool('lost03_ac17_meet_heartbeat');
      const homePool = namedPool('lost03_ac17_meet_home');
      const holder = await session();
      try {
        await holder.query('begin');
        await holder.query('select id from journeys where id = $1 for update', [journeyId]);
        const beat = () =>
          post(
            realApi({ database: createDatabase(heartbeatPool) }),
            device.credential,
            'heartbeats',
            syntheticHeartbeat({ journeyId }),
          );
        const ending = () =>
          home(realApi({ database: createDatabase(homePool) }), device.credential, journeyId);
        // The first waits in the row's queue before the second asks, so the
        // row is granted in that order once the holder lets go.
        const [first, firstTag, second, secondTag] =
          order === 'heartbeat first'
            ? [beat, 'lost03_ac17_meet_heartbeat', ending, 'lost03_ac17_meet_home']
            : [ending, 'lost03_ac17_meet_home', beat, 'lost03_ac17_meet_heartbeat'];
        const a = first();
        a.catch(() => undefined);
        expect(await eventually(async () => (await waitingOnALock(firstTag)) === 1)).toBe(true);
        const b = second();
        b.catch(() => undefined);
        expect(await eventually(async () => (await waitingOnALock(secondTag)) === 1)).toBe(true);
        await holder.query('commit');
        const [firstAnswer, secondAnswer] = await Promise.all([a, b]);

        if (order === 'heartbeat first') {
          expect([firstAnswer.status, secondAnswer.status]).toEqual([200, 200]);
          expect(ofKind(await messagesOf(journeyId), 'HOME')).toEqual([]);
        } else {
          expect([firstAnswer.status, secondAnswer.status]).toEqual([200, 409]);
          expect(secondAnswer.body?.['code']).toBe('JOURNEY_ENDED');
          expect(await heartbeatCountOf(journeyId)).toBe(0);
          expect(ofKind(await messagesOf(journeyId), 'BACK_IN_CONTACT')).toEqual([]);
        }
      } finally {
        await holder.query('rollback').catch(() => undefined);
        await holder.end();
        await endTestPool(heartbeatPool);
        await endTestPool(homePool);
      }

      expect(await stateOf(journeyId)).toBe('ENDED');
      expect((await alertsOf(journeyId)).map(({ state }) => state)).toEqual(['RESOLVED']);
      const standDowns = (await messagesOf(journeyId)).filter(
        ({ kind }) => kind !== 'LOST_CONTACT',
      );
      expect(recipientsOf(standDowns)).toEqual([...responderIds].sort());
    },
    30_000,
  );

  test('LOST-03-AC17: two "I’m home" requests for J at once, on separate connections: one is 200 and the other 409, with one resolution and one HOME message per responder', async () => {
    const { device, journeyId, responderIds } = await lost({ responders: 2 });
    const api = realApi();

    const answers = await Promise.all([
      home(api, device.credential, journeyId),
      home(api, device.credential, journeyId),
    ]);

    expect(answers.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect((await alertsOf(journeyId)).map(({ state }) => state)).toEqual(['RESOLVED']);
    expect(recipientsOf(ofKind(await messagesOf(journeyId), 'HOME'))).toEqual(
      [...responderIds].sort(),
    );
  });
});
