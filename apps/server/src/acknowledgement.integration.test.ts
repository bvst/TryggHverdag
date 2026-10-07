// L3 server integration: "I'm on it" (LOST-06) on the real tables.
//
// The system tests prove the rule and the flows against a fake store. What
// only a real PostgreSQL can prove is here:
//   - the flow, through the real adapter, the real modules and the recording
//     push (AC1);
//   - that nothing which refuses takes a lock, and what records waits for the
//     journey's row (AC3);
//   - the database's own refusal of a second notice (AC4); racing
//     acknowledgements on separate connections (AC6);
//   - the per-responder hold, to the microsecond (AC8); every time the
//     database's now() (AC9);
//   - all or nothing, with a test trigger that fails the second notice
//     (AC11);
//   - an acknowledgement, a heartbeat, "I'm home" and the watchdog meeting on
//     the journey's row, in each order and at the same moment (AC12).
// The shared behaviour suite runs the store's side of AC2 to AC8 and AC13
// against the adapter in adapters/journeys.integration.test.ts; AC10's and
// AC17's tables are read there and in deploy.integration.test.ts.
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
  syntheticUuid,
  type FakeLog,
  type FakePush,
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
import { LOCK_WAIT_LIMIT_MS } from './domain/watchdog.ts';
import { createAcknowledgementService } from './modules/alerts/acknowledgement.ts';
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

const ON_IT = { outcome: 'ACKNOWLEDGED' };

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
  // earlier test's alert and write SMS that no test here asked for. So the
  // leftovers are resolved too, as "I'm home" would have resolved them.
  // Nothing a test asserts about its own rows changes.
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

/** A pool of its own, named, with the API's lock limit, so a test can see in pg_stat_activity what its sessions wait for. */
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

/** A user with a device, and the credential that device would send: a walker, or a responder. */
async function person(): Promise<{ userId: string; deviceId: string; credential: string }> {
  const userId = await addUser();
  return { userId, ...(await addDevice(userId)) };
}

type Person = Awaited<ReturnType<typeof person>>;

/**
 * An ACTIVE journey of a new walker, put in directly with `responders`
 * responders, each with a device of their own: started an hour before now(),
 * and last heard from `silentForMs` before now().
 */
async function silent({
  responders = 3,
  silentForMs = HOUR,
}: { responders?: number; silentForMs?: number } = {}) {
  const walker = await person();
  const following: Person[] = [];
  for (let i = 0; i < responders; i += 1) {
    following.push(await person());
  }
  const journeyId = syntheticUuid();
  await connection().query(
    `insert into journeys (id, walker_id, device_id, state, started_at, last_heartbeat_at)
     values ($1, $2, $3, 'ACTIVE', now() - interval '2 hours',
             now() - ($4::double precision * interval '1 millisecond'))`,
    [journeyId, walker.userId, walker.deviceId, silentForMs],
  );
  for (const { userId } of following) {
    await connection().query(
      'insert into journey_responders (journey_id, responder_id) values ($1, $2)',
      [journeyId, userId],
    );
  }
  return { walker, responders: following, journeyId };
}

const store = () => databaseJourneyStore(database());

/** A silent journey, opened by the real adapter: LOST_CONTACT, its alert, and one unsent LOST_CONTACT message per responder. */
async function lost({ responders = 3 }: { responders?: number } = {}) {
  const journey = await silent({ responders });
  const opened = await store().openLostContactAlert({
    journeyId: journey.journeyId,
    afterMs: LOST_CONTACT_AFTER_MS,
  });
  if (opened.outcome !== 'opened') {
    throw new Error(`expected the journey to be opened, but it was ${opened.outcome}`);
  }
  return { ...journey, alertId: opened.alertId };
}

/** A moment as milliseconds since the epoch, in SQL, floored as a Date floors it. */
const MS = (column: string) => `floor(extract(epoch from ${column}) * 1000)::bigint::text`;

async function databaseNowMs(): Promise<number> {
  const result = await connection().query<{ ms: string }>(`select ${MS('now()')} as ms`);
  return Number(result.rows[0]?.ms);
}

const numberOrNull = (ms: string | null | undefined): number | null =>
  ms === null || ms === undefined ? null : Number(ms);

async function stateOf(journeyId: string): Promise<string | null> {
  const result = await connection().query<{ state: string }>(
    'select state::text as state from journeys where id = $1',
    [journeyId],
  );
  return result.rows[0]?.state ?? null;
}

/** The journey's alerts, as the table holds them, who is on each among them. */
async function alertsOf(journeyId: string) {
  const result = await connection().query<{
    id: string;
    state: string;
    opened_ms: string;
    resolved_ms: string | null;
    resolution: string | null;
    acknowledged_by: string | null;
    acknowledged_ms: string | null;
    acknowledged_text: string | null;
  }>(
    `select id::text as id, state::text as state, ${MS('opened_at')} as opened_ms,
            ${MS('resolved_at')} as resolved_ms, resolution::text as resolution,
            acknowledged_by::text as acknowledged_by, ${MS('acknowledged_at')} as acknowledged_ms,
            acknowledged_at::text as acknowledged_text
       from alerts where journey_id = $1 order by opened_at, id`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    state: row.state,
    openedAt: Number(row.opened_ms),
    resolvedAt: numberOrNull(row.resolved_ms),
    resolution: row.resolution,
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: numberOrNull(row.acknowledged_ms),
    /** acknowledged_at as PostgreSQL prints it, to the microsecond. */
    acknowledgedText: row.acknowledged_text,
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
    created_text: string;
    next_ms: string;
    next_text: string;
    sent_ms: string | null;
    withdrawn_ms: string | null;
    last_failure: string | null;
  }>(
    `select o.id::text as message_id, o.alert_id::text as alert_id,
            o.recipient_id::text as recipient_id, o.kind::text as kind,
            o.attempts::int as attempts, ${MS('o.created_at')} as created_ms,
            o.created_at::text as created_text,
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
    /** created_at as PostgreSQL prints it, to the microsecond. */
    createdText: row.created_text,
    nextAttemptAt: Number(row.next_ms),
    /** next_attempt_at as PostgreSQL prints it, to the microsecond. */
    nextAttemptText: row.next_text,
    sentAt: numberOrNull(row.sent_ms),
    withdrawnAt: numberOrNull(row.withdrawn_ms),
    lastFailure: row.last_failure,
  }));
}

/** Everything the tables hold of a journey's alerts and messages, to compare before and after. */
async function recordOf(journeyId: string) {
  return {
    state: await stateOf(journeyId),
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

/** A trigger that holds a transaction open behind a gate, after `event` on `table`, when `condition` holds. */
function holdBehind(key: number, table: string, event: string, condition: string) {
  const name = `lost06_hold_${table}_${event}`;
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

// ---------------------------------------------------------------------------
// The real adapter, the real modules, and the recording fakes at the edge.
// ---------------------------------------------------------------------------

function watchdogFor({ log = fakeLog() }: { log?: FakeLog } = {}) {
  return createWatchdog({
    journeys: store(),
    beats: databaseWorkerHeartbeats(database()),
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
    acknowledgements: createAcknowledgementService({ alerts: databaseJourneyStore(on), log }),
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

/** "I'm on it" through the API (D-114). */
const acknowledge = (api: ReturnType<typeof realApi>, credential: string, alertId: string) =>
  post(api, credential, `alerts/${alertId}/acknowledgement`);

/** "I'm on it" through the API, its answer as sent: status, body text and headers. */
async function acknowledgeAsSent(
  api: ReturnType<typeof realApi>,
  credential: string,
  alertId: string,
): Promise<{ status: number; text: string; headers: string }> {
  const response = await api.request(apiPath(`alerts/${alertId}/acknowledgement`), {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}` },
  });
  return {
    status: response.status,
    text: await response.text(),
    headers: [...response.headers].map(([name, value]) => `${name}: ${value}`).join('\n'),
  };
}

const home = (api: ReturnType<typeof realApi>, credential: string, journeyId: string) =>
  post(api, credential, `journeys/${journeyId}/home`);

const recipientsOf = (messages: readonly { recipientId: string }[]) =>
  messages.map(({ recipientId }) => recipientId).sort();

const ofKind = <T extends { kind: string }>(messages: readonly T[], kind: string): T[] =>
  messages.filter((message) => message.kind === kind);

const idsOf = (people: readonly Person[]) => people.map(({ userId }) => userId);

/** A heartbeat for the store, received at the database's now: as fresh as contact gets. */
async function freshHeartbeat(journeyId: string) {
  return {
    journeyId,
    eventId: syntheticEventId(),
    receivedAt: new Date(await databaseNowMs()),
    batteryLevel: null,
    position: null,
  };
}

// ---------------------------------------------------------------------------
// LOST-06-AC1: the flow, on the real tables.
// ---------------------------------------------------------------------------

describe('LOST-06 and LOST-02: "I’m on it", on the real tables', () => {
  test('LOST-06-AC1: a journey started through the API with R1, R2 and R3, each with a device, silent past five minutes and alerted by the real watchdog and sender: R1’s "I’m on it" through the API is 200 ACKNOWLEDGED; the alert ACKNOWLEDGED by R1 between two readings of now(); J LOST_CONTACT with no other alert; the sender then hands exactly one ACKNOWLEDGED to R2 and one to R3, none to R1 or the walker; another sweep and delivery add nothing', async () => {
    const api = realApi();
    const push = fakePush();
    const log = fakeLog();
    const walker = await person();
    const [r1, r2, r3] = [await person(), await person(), await person()];
    const started = await post(api, walker.credential, 'journeys', {
      responderIds: idsOf([r1, r2, r3]),
    });
    expect(started.status).toBe(201);
    const journeyId = String(started.body?.['journeyId']);
    const sent = await post(
      api,
      walker.credential,
      'heartbeats',
      syntheticHeartbeat({ journeyId }),
    );
    expect(sent.status).toBe(200);
    // Silent past five minutes, relative to the database's own now().
    await connection().query(
      `update journeys set started_at = now() - interval '15 minutes',
              last_heartbeat_at = now() - interval '5 minutes 1 second' where id = $1`,
      [journeyId],
    );
    expect((await watchdogFor({ log }).sweep()).opened).toBe(1);
    await senderFor({ push, log }).deliverDue();
    expect(recipientsOf(ofKind(push.accepted, 'LOST_CONTACT'))).toEqual(idsOf([r1, r2, r3]).sort());
    const [opened] = await alertsOf(journeyId);
    const alertId = opened?.id ?? '';

    const before = await databaseNowMs();
    const answer = await acknowledge(api, r1.credential, alertId);
    const after = await databaseNowMs();

    expect(answer).toEqual({ status: 200, body: ON_IT });
    const [alert, ...others] = await alertsOf(journeyId);
    expect(others).toEqual([]);
    expect(alert).toMatchObject({ id: alertId, state: 'ACKNOWLEDGED', acknowledgedBy: r1.userId });
    expect(alert?.acknowledgedAt).toBeGreaterThanOrEqual(before);
    expect(alert?.acknowledgedAt).toBeLessThanOrEqual(after);
    expect(await stateOf(journeyId)).toBe('LOST_CONTACT');

    await senderFor({ push, log }).deliverDue();
    expect(recipientsOf(ofKind(push.accepted, 'ACKNOWLEDGED'))).toEqual(idsOf([r2, r3]).sort());
    expect(recipientsOf(ofKind(push.messages, 'ACKNOWLEDGED'))).not.toContain(r1.userId);
    expect(recipientsOf(push.messages)).not.toContain(walker.userId);

    const handedOver = push.messages.length;
    expect((await watchdogFor({ log }).sweep()).opened).toBe(0);
    await senderFor({ push, log }).deliverDue();
    expect(push.messages).toHaveLength(handedOver);
    expect(log.events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LOST-06-AC3: nothing that refuses takes a lock.
// ---------------------------------------------------------------------------

describe('LOST-06 and SEC-07: nothing that refuses takes a lock, and what records waits for the journey’s row', () => {
  test('LOST-06-AC3: while other sessions hold J’s row and the row of a journey whose alert has resolved, the 404s — the walker, another walker, a responder of another journey, an alert ID no alert has — and an acknowledgement of the resolved alert are answered without waiting; R1’s acknowledgement of J’s open alert waits for the row (pg_stat_activity), and is recorded once it is let go', async () => {
    const j = await lost({ responders: 2 });
    const [r1] = j.responders as [Person, Person];
    const resolved = await lost({ responders: 1 });
    const back = await store().recordHeartbeat(await freshHeartbeat(resolved.journeyId));
    expect(back.outcome).toBe('back_in_contact');
    const otherWalker = await person();
    const elsewhere = await silent({ responders: 1 });
    const [theirResponder] = elsewhere.responders as [Person];
    const tag = 'lost06_ac3_acknowledgement';
    const ackPool = namedPool(tag, 4);
    const api = realApi({ database: createDatabase(ackPool) });
    const holder = await session();
    const before = await recordOf(j.journeyId);
    try {
      await holder.query('begin');
      await holder.query('select id from journeys where id = any($1::uuid[]) for update', [
        [j.journeyId, resolved.journeyId],
      ]);

      for (const [who, credential, alertId] of [
        ['the walker', j.walker.credential, j.alertId],
        ['another walker', otherWalker.credential, j.alertId],
        ['a responder of another journey', theirResponder.credential, j.alertId],
        ['an alert ID no alert has', r1.credential, syntheticUuid()],
        // RG-03 (LOST-06 review loop 2, privacy-security-reviewer's note):
        // added. Strangers at the resolved alert too, whose journey's row is
        // held as well: a stranger sent down the locking path for an alert
        // that is not OPEN would still get 404, but only after waiting on
        // the row, a timing signal and a wait the watchdog would share.
        ['its own walker, at the resolved alert', resolved.walker.credential, resolved.alertId],
        ['another walker, at the resolved alert', otherWalker.credential, resolved.alertId],
        [
          'a responder of another journey, at the resolved alert',
          theirResponder.credential,
          resolved.alertId,
        ],
        ['a responder of J, at the resolved alert', r1.credential, resolved.alertId],
      ] as const) {
        const answer = await bounded(acknowledge(api, credential, alertId), 2 * SECOND);
        expect(answer, who).toMatchObject({ status: 404, body: { code: 'ALERT_NOT_FOUND' } });
      }
      const over = await bounded(
        acknowledge(api, resolved.responders[0]?.credential ?? '', resolved.alertId),
        2 * SECOND,
      );
      expect(over, 'the resolved alert').toMatchObject({
        status: 409,
        body: { code: 'ALERT_RESOLVED' },
      });
      expect(await waitingOnALock(tag)).toBe(0);

      let answer: unknown;
      const recording = acknowledge(api, r1.credential, j.alertId).then((result) => {
        answer = result;
      });
      recording.catch(() => undefined);
      expect(await eventually(async () => (await waitingOnALock(tag)) === 1)).toBe(true);
      expect(answer).toBeUndefined();
      expect(await recordOf(j.journeyId)).toEqual(before);

      await holder.query('commit');
      await recording;
      expect(answer).toEqual({ status: 200, body: ON_IT });
    } finally {
      await holder.query('rollback').catch(() => undefined);
      await holder.end();
      await endTestPool(ackPool);
    }
    expect((await alertsOf(j.journeyId))[0]?.acknowledgedBy).toBe(r1.userId);
  }, 30_000);

  test('LOST-06-AC3: a stranger learns nothing of the alert’s state: with J’s alert OPEN, then ACKNOWLEDGED by R1 through the API, then RESOLVED by a fresh heartbeat, the walker, another walker, a responder of another journey only and an alert ID no alert has are each 404 ALERT_NOT_FOUND through the API, status, body and headers byte for byte the answer they got while it was OPEN; the tables are unchanged, and no line is written', async () => {
    // SEC-07 and reading 5, on the real tables: "not a responder" comes
    // before "resolved" and "taken", whatever the module reads first.
    const log = fakeLog();
    const api = realApi({ log });
    const j = await lost({ responders: 2 });
    const [r1] = j.responders as [Person, Person];
    const otherWalker = await person();
    const elsewhere = await silent({ responders: 1 });
    const [theirResponder] = elsewhere.responders as [Person];
    const strangers = [
      ['the walker', j.walker.credential, j.alertId],
      ['another walker', otherWalker.credential, j.alertId],
      ['a responder of another journey only', theirResponder.credential, j.alertId],
      ['an alert ID no alert has', r1.credential, syntheticUuid()],
    ] as const;
    const ask = async () => {
      const answers: Awaited<ReturnType<typeof acknowledgeAsSent>>[] = [];
      for (const [, credential, alertId] of strangers) {
        answers.push(await acknowledgeAsSent(api, credential, alertId));
      }
      return answers;
    };

    const whileOpen = await ask();
    // Control: what every stranger is told while the alert is OPEN.
    for (const [index, [who]] of strangers.entries()) {
      expect(whileOpen[index]?.status, who).toBe(404);
      expect(parsedOrNull(whileOpen[index]?.text ?? '')?.['code'], who).toBe('ALERT_NOT_FOUND');
      expect(whileOpen[index]?.text, who).toBe(whileOpen[0]?.text);
    }

    expect(await acknowledge(api, r1.credential, j.alertId)).toEqual({ status: 200, body: ON_IT });
    const acknowledged = await recordOf(j.journeyId);
    expect(acknowledged.alerts).toMatchObject([
      { state: 'ACKNOWLEDGED', acknowledgedBy: r1.userId },
    ]);

    expect(await ask(), 'with the alert ACKNOWLEDGED').toEqual(whileOpen);
    expect(await recordOf(j.journeyId)).toEqual(acknowledged);

    const back = await store().recordHeartbeat(await freshHeartbeat(j.journeyId));
    expect(back.outcome).toBe('back_in_contact');
    const resolved = await recordOf(j.journeyId);
    expect(resolved.alerts).toMatchObject([{ state: 'RESOLVED', acknowledgedBy: r1.userId }]);

    expect(await ask(), 'with the alert RESOLVED').toEqual(whileOpen);
    expect(await recordOf(j.journeyId)).toEqual(resolved);
    expect(log.events).toEqual([]);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// LOST-06-AC4, AC6, AC8 and AC9: what the tables hold.
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

describe('LOST-06, SM-08 and SM-09: the database holds one acknowledger, one set of notices, and its own times', () => {
  test('LOST-06-AC4: the database itself refuses a second ACKNOWLEDGED message for the same alert and recipient; another recipient is taken', async () => {
    const { alertId, responders } = await lost({ responders: 2 });
    const [first, second] = idsOf(responders);

    await expect(
      insertMessage({ alertId, recipientId: first ?? '', kind: 'ACKNOWLEDGED' }),
    ).resolves.toBeDefined();
    await expect(
      insertMessage({ alertId, recipientId: first ?? '', kind: 'ACKNOWLEDGED' }),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      insertMessage({ alertId, recipientId: second ?? '', kind: 'ACKNOWLEDGED' }),
    ).resolves.toBeDefined();
  });

  test(`LOST-06-AC6: ${String(RACERS)} different responders of J acknowledge A through the API at once, on separate connections, ${String(RACE_ROUNDS)} times over: exactly one 200 and every other 409 ALREADY_ACKNOWLEDGED, none an error; acknowledged_by the one recorded, and one ACKNOWLEDGED message per other responder; then ${String(RACERS)} copies of one responder’s at once are every one 200, recorded once, with one set of messages`, async () => {
    const api = realApi();
    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const at = `round ${String(round)}`;
      const { journeyId, alertId, responders } = await lost({ responders: RACERS });

      const answers = await Promise.all(
        responders.map(({ credential }) => acknowledge(api, credential, alertId)),
      );

      const recorded = responders.filter((_, index) => answers[index]?.status === 200);
      expect(recorded, at).toHaveLength(1);
      // Each answer but the 200, as its status and its body's code: a body
      // that is not an object has no code, and fails.
      expect(
        answers
          .filter(({ status }) => status !== 200)
          .map(({ status, body }) => ({ status, code: body?.['code'] })),
        at,
      ).toEqual(
        Array.from({ length: RACERS - 1 }, () => ({ status: 409, code: 'ALREADY_ACKNOWLEDGED' })),
      );
      const [winner] = recorded;
      expect((await alertsOf(journeyId))[0]?.acknowledgedBy, at).toBe(winner?.userId);
      expect(recipientsOf(ofKind(await messagesOf(journeyId), 'ACKNOWLEDGED')), at).toEqual(
        idsOf(responders)
          .filter((id) => id !== winner?.userId)
          .sort(),
      );

      const copies = await lost({ responders: 2 });
      const [r1, r2] = copies.responders as [Person, Person];
      const again = await Promise.all(
        Array.from({ length: RACERS }, () => acknowledge(api, r1.credential, copies.alertId)),
      );
      expect(again, at).toEqual(again.map(() => ({ status: 200, body: ON_IT })));
      expect((await alertsOf(copies.journeyId))[0]?.acknowledgedBy, at).toBe(r1.userId);
      expect(recipientsOf(ofKind(await messagesOf(copies.journeyId), 'ACKNOWLEDGED')), at).toEqual([
        r2.userId,
      ]);
    }
  }, 120_000);

  test.each(['ACKNOWLEDGED', 'LOST_CONTACT'] as const)(
    'LOST-06-AC8: R2’s lost-contact message and notice both handed over, refused and due again later, the %s one later: a fresh heartbeat is back in contact, not refused, and R2’s one stand-down’s next_attempt_at is, to the microsecond, the later of the two due times the withdrawal found; R1’s and R3’s are the resolution’s now()',
    async (later) => {
      const { journeyId, alertId, responders } = await lost({ responders: 3 });
      const [r1, r2, r3] = responders as [Person, Person, Person];
      const recorded = await store().recordAcknowledgement({ alertId, responderId: r1.userId });
      expect(recorded.outcome).toBe('acknowledged');
      // R3's both sent; R2's both refused NO_TARGET, due again 20 s and 40 s on.
      await connection().query(
        'update outbox set attempts = 1, sent_at = now() where alert_id = $1 and recipient_id = $2',
        [alertId, r3.userId],
      );
      for (const [kind, seconds] of [
        ['LOST_CONTACT', later === 'LOST_CONTACT' ? 40 : 20],
        ['ACKNOWLEDGED', later === 'ACKNOWLEDGED' ? 40 : 20],
      ] as const) {
        await connection().query(
          `update outbox set attempts = 1, last_failure = 'NO_TARGET',
                  next_attempt_at = now() + ($4::int * interval '1 second')
            where alert_id = $1 and recipient_id = $2 and kind = $3`,
          [alertId, r2.userId, kind, seconds],
        );
      }
      const dueTimes = (await messagesOf(journeyId)).filter(
        ({ recipientId }) => recipientId === r2.userId,
      );
      const laterDue = dueTimes.find(({ kind }) => kind === later)?.nextAttemptText;

      const back = await store().recordHeartbeat(await freshHeartbeat(journeyId));

      expect(back.outcome).toBe('back_in_contact');
      const messages = await messagesOf(journeyId);
      const standDowns = ofKind(messages, 'BACK_IN_CONTACT');
      expect(recipientsOf(standDowns)).toEqual(idsOf([r1, r2, r3]).sort());
      const standDownOf = (recipientId: string) =>
        standDowns.find((message) => message.recipientId === recipientId);
      expect(standDownOf(r2.userId)?.nextAttemptText).toBe(laterDue);
      const [alert] = await alertsOf(journeyId);
      expect(standDownOf(r1.userId)?.nextAttemptAt).toBe(alert?.resolvedAt);
      expect(standDownOf(r3.userId)?.nextAttemptAt).toBe(alert?.resolvedAt);
      expect(
        messages
          .filter(
            ({ recipientId, kind }) => recipientId === r2.userId && kind !== 'BACK_IN_CONTACT',
          )
          .map(({ withdrawnAt }) => withdrawnAt),
      ).toEqual([alert?.resolvedAt, alert?.resolvedAt]);
    },
  );

  test('LOST-06-AC9: acknowledged_at lies between two readings of now() taken before and after the call, and never before the alert’s opened_at; a repeat moves neither acknowledged_by nor acknowledged_at, a refusal touches neither, and a resolution keeps both', async () => {
    const api = realApi();
    const { journeyId, alertId, responders } = await lost({ responders: 2 });
    const [r1, r2] = responders as [Person, Person];

    const before = await databaseNowMs();
    expect(await acknowledge(api, r1.credential, alertId)).toEqual({ status: 200, body: ON_IT });
    const after = await databaseNowMs();

    const [first] = await alertsOf(journeyId);
    expect(first?.acknowledgedBy).toBe(r1.userId);
    expect(first?.acknowledgedAt).toBeGreaterThanOrEqual(before);
    expect(first?.acknowledgedAt).toBeLessThanOrEqual(after);
    expect(first?.acknowledgedAt).toBeGreaterThanOrEqual(
      first?.openedAt ?? Number.POSITIVE_INFINITY,
    );
    // RG-03 (LOST-06 review loop 2, test-auditor's should-fix): added. The
    // bracket above cannot tell the transaction's now() from the app's clock,
    // statement_timestamp() or clock_timestamp(): app and database share one
    // host clock. Inside the one transaction now() is a single reading, so the
    // record and its notice hold the same moment, to the microsecond.
    const notices = ofKind(await messagesOf(journeyId), 'ACKNOWLEDGED');
    expect(notices.map(({ recipientId }) => recipientId)).toEqual([r2.userId]);
    for (const notice of notices) {
      expect(notice.createdText, 'the notice’s created_at').toBe(first?.acknowledgedText);
      expect(notice.nextAttemptText, 'the notice’s next_attempt_at').toBe(first?.acknowledgedText);
    }
    const recorded = { by: first?.acknowledgedBy, at: first?.acknowledgedText };

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await acknowledge(api, r1.credential, alertId)).toEqual({ status: 200, body: ON_IT });
    expect((await acknowledge(api, r2.credential, alertId)).status).toBe(409);
    const [repeated] = await alertsOf(journeyId);
    expect({ by: repeated?.acknowledgedBy, at: repeated?.acknowledgedText }).toEqual(recorded);

    expect((await store().recordHeartbeat(await freshHeartbeat(journeyId))).outcome).toBe(
      'back_in_contact',
    );
    const [resolved] = await alertsOf(journeyId);
    expect(resolved?.state).toBe('RESOLVED');
    expect({ by: resolved?.acknowledgedBy, at: resolved?.acknowledgedText }).toEqual(recorded);
  });
});

// ---------------------------------------------------------------------------
// LOST-06-AC11: all or nothing (AR-05).
// ---------------------------------------------------------------------------

/** A test trigger refusing a second ACKNOWLEDGED message for an alert: the moment a missing transaction would show. */
function refuseASecondNotice() {
  const name = 'lost06_refuse_a_second_notice';
  return {
    create: [
      `create function ${name}() returns trigger language plpgsql as $$
         begin
           if new.kind::text = 'ACKNOWLEDGED'
              and exists (select 1 from outbox where alert_id = new.alert_id and kind = new.kind) then
             raise exception 'a second notice refused by a test trigger' using errcode = 'P0001';
           end if;
           return new;
         end
       $$`,
      `create trigger ${name} before insert on outbox for each row execute function ${name}()`,
    ],
    drop: [`drop trigger if exists ${name} on outbox`, `drop function if exists ${name}()`],
  };
}

/**
 * The transaction that wrote the alert's row as it stands, and each of its
 * ACKNOWLEDGED messages' (PostgreSQL's xmin): one transaction writes them all,
 * or they show different ones.
 */
async function writersOf(alertId: string) {
  const alert = await connection().query<{ xmin: string }>(
    'select xmin::text as xmin from alerts where id = $1',
    [alertId],
  );
  const notices = await connection().query<{ xmin: string }>(
    `select xmin::text as xmin from outbox where alert_id = $1 and kind = 'ACKNOWLEDGED'
      order by recipient_id`,
    [alertId],
  );
  return { alert: alert.rows[0]?.xmin, notices: notices.rows.map(({ xmin }) => xmin) };
}

describe('LOST-06 and AR-05: the acknowledgement and its notices are one transaction', () => {
  test('LOST-06-AC11: with a test trigger refusing the second ACKNOWLEDGED message, R1’s "I’m on it" through the module fails with one acknowledgement_failed line, stage store and the SQLSTATE, and through the API is 500; nothing changed: A OPEN, nobody recorded, no ACKNOWLEDGED message; without the trigger, the same request is 200 and does all of AC1’s work', async () => {
    const { journeyId, alertId, responders } = await lost({ responders: 3 });
    const [r1, r2, r3] = responders as [Person, Person, Person];
    const moduleLog = fakeLog();
    const module = createAcknowledgementService({ alerts: store(), log: moduleLog });
    const apiLog = fakeLog();
    const api = realApi({ log: apiLog });
    const before = await recordOf(journeyId);
    const { create, drop } = refuseASecondNotice();

    await withTrigger(create, drop, async () => {
      await expect(module.acknowledge({ responderId: r1.userId, alertId })).rejects.toThrow();
      expect(moduleLog.events).toEqual([
        { event: 'acknowledgement_failed', stage: 'store', code: 'P0001' },
      ]);

      const failed = await acknowledge(api, r1.credential, alertId);
      expect(failed.status).toBe(500);
      expect(apiLog.events).toEqual([
        { event: 'acknowledgement_failed', stage: 'store', code: 'P0001' },
      ]);

      expect(await recordOf(journeyId)).toEqual(before);
      expect(
        before.alerts.map(({ state, acknowledgedBy, acknowledgedAt }) => [
          state,
          acknowledgedBy,
          acknowledgedAt,
        ]),
      ).toEqual([['OPEN', null, null]]);
      expect(ofKind(before.messages, 'ACKNOWLEDGED')).toEqual([]);
    });

    expect(await acknowledge(api, r1.credential, alertId)).toEqual({ status: 200, body: ON_IT });
    expect((await alertsOf(journeyId))[0]).toMatchObject({
      state: 'ACKNOWLEDGED',
      acknowledgedBy: r1.userId,
    });
    expect(recipientsOf(ofKind(await messagesOf(journeyId), 'ACKNOWLEDGED'))).toEqual(
      idsOf([r2, r3]).sort(),
    );

    // RG-03 (LOST-06 review loop 2, test-auditor's should-fix): added. The
    // trigger above cannot tell notices written outside the acknowledgement's
    // transaction: it fails their one multi-row insert, which rolls back as
    // one statement wherever it runs. Written in the same transaction, the
    // alert's row and every notice's carry the same xmin, and the same now(),
    // to the microsecond.
    const writers = await writersOf(alertId);
    expect(writers.alert).toBeDefined();
    expect(writers.notices).toEqual([writers.alert, writers.alert]);
    const [acknowledged] = await alertsOf(journeyId);
    for (const notice of ofKind(await messagesOf(journeyId), 'ACKNOWLEDGED')) {
      expect(notice.createdText, 'the notice’s created_at').toBe(acknowledged?.acknowledgedText);
      expect(notice.nextAttemptText, 'the notice’s next_attempt_at').toBe(
        acknowledged?.acknowledgedText,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// LOST-06-AC12: meeting on the journey's row.
// ---------------------------------------------------------------------------

describe('LOST-06, LOST-03, SM-04 and SM-09: "I’m on it" meets back in contact, "I’m home" and the watchdog on the journey’s row', () => {
  test.each(['a fresh heartbeat', '"I’m home"'] as const)(
    'LOST-06-AC12: an acknowledgement’s transaction holding J’s row before commit as %s for J arrives: it waits for the row (pg_stat_activity), then resolves A, keeping R1 as its acknowledger; the unsent ACKNOWLEDGED messages withdrawn; one stand-down per responder',
    async (how) => {
      const { walker, journeyId, alertId, responders } = await lost({ responders: 3 });
      const [r1] = responders as [Person, Person, Person];
      const tag = 'lost06_ac12_resolution';
      const resolvingPool = namedPool(tag);
      const held = await gate();
      try {
        const { create, drop } = holdBehind(
          held.key,
          'alerts',
          'update',
          "new.state = 'ACKNOWLEDGED'",
        );
        await withTrigger(create, drop, async () => {
          const acknowledging = acknowledge(realApi(), r1.credential, alertId);
          acknowledging.catch(() => undefined);
          try {
            expect(await eventually(someoneAtTheGate)).toBe(true);
            const resolving =
              how === 'a fresh heartbeat'
                ? post(
                    realApi({ database: createDatabase(resolvingPool) }),
                    walker.credential,
                    'heartbeats',
                    syntheticHeartbeat({ journeyId }),
                  )
                : home(
                    realApi({ database: createDatabase(resolvingPool) }),
                    walker.credential,
                    journeyId,
                  );
            resolving.catch(() => undefined);
            expect(await eventually(async () => (await waitingOnALock(tag)) === 1)).toBe(true);

            await held.open();
            expect(await acknowledging).toEqual({ status: 200, body: ON_IT });
            expect((await resolving).status).toBe(200);
          } finally {
            await held.open();
          }
        });
      } finally {
        await held.end();
        await endTestPool(resolvingPool);
      }

      const kind = how === 'a fresh heartbeat' ? 'BACK_IN_CONTACT' : 'HOME';
      const [alert] = await alertsOf(journeyId);
      expect(alert).toMatchObject({
        state: 'RESOLVED',
        resolution: kind,
        acknowledgedBy: r1.userId,
      });
      const messages = await messagesOf(journeyId);
      expect(ofKind(messages, 'ACKNOWLEDGED').map(({ withdrawnAt }) => withdrawnAt)).toEqual([
        alert?.resolvedAt,
        alert?.resolvedAt,
      ]);
      expect(recipientsOf(ofKind(messages, kind))).toEqual(idsOf(responders).sort());
    },
    30_000,
  );

  test.each(['a fresh heartbeat', '"I’m home"'] as const)(
    'LOST-06-AC12: %s holding J’s row before commit as an acknowledgement past its read arrives: the acknowledgement waits (pg_stat_activity), then is 409 ALERT_RESOLVED and writes nothing',
    async (how) => {
      const { walker, journeyId, alertId, responders } = await lost({ responders: 2 });
      const [r1] = responders as [Person, Person];
      const tag = 'lost06_ac12_acknowledgement';
      const ackPool = namedPool(tag);
      const log = fakeLog();
      const held = await gate();
      try {
        const { create, drop } = holdBehind(held.key, 'alerts', 'update', "new.state = 'RESOLVED'");
        await withTrigger(create, drop, async () => {
          const resolving =
            how === 'a fresh heartbeat'
              ? post(realApi(), walker.credential, 'heartbeats', syntheticHeartbeat({ journeyId }))
              : home(realApi(), walker.credential, journeyId);
          resolving.catch(() => undefined);
          try {
            expect(await eventually(someoneAtTheGate)).toBe(true);
            const acknowledging = acknowledge(
              realApi({ database: createDatabase(ackPool), log }),
              r1.credential,
              alertId,
            );
            acknowledging.catch(() => undefined);
            // Past its read, which saw A still open, and waiting for the row.
            expect(await eventually(async () => (await waitingOnALock(tag)) === 1)).toBe(true);

            await held.open();
            expect((await resolving).status).toBe(200);
            expect(await acknowledging).toMatchObject({
              status: 409,
              body: { code: 'ALERT_RESOLVED' },
            });
          } finally {
            await held.open();
          }
        });
      } finally {
        await held.end();
        await endTestPool(ackPool);
      }

      const [alert] = await alertsOf(journeyId);
      expect(alert).toMatchObject({
        state: 'RESOLVED',
        acknowledgedBy: null,
        acknowledgedAt: null,
      });
      expect(ofKind(await messagesOf(journeyId), 'ACKNOWLEDGED')).toEqual([]);
      expect(log.events).toEqual([
        { event: 'acknowledgement_ignored', reason: 'ALERT_RESOLVED', alertId },
      ]);
    },
    30_000,
  );

  test(`LOST-06-AC12: an acknowledgement, a fresh heartbeat and a sweep starting at the same moment on separate connections, ${String(2 * RACE_ROUNDS)} rounds: every round ends with A RESOLVED, one alert and one stand-down per responder, and either R1 recorded with every notice withdrawn or nobody recorded and no notice; never an ACKNOWLEDGED message unsent and unwithdrawn on a RESOLVED alert`, async () => {
    const api = realApi();
    const outcomes = new Set<string>();
    for (let round = 0; round < 2 * RACE_ROUNDS; round += 1) {
      const at = `round ${String(round)}`;
      const { journeyId, alertId, responders } = await lost({ responders: 2 });
      const [r1] = responders as [Person, Person];
      const heartbeat = await freshHeartbeat(journeyId);

      const [acknowledged, swept, back] = await Promise.all([
        acknowledge(api, r1.credential, alertId),
        watchdogFor().sweep(),
        store().recordHeartbeat(heartbeat),
      ]);

      expect(swept.ok, at).toBe(true);
      expect(back.outcome, at).toBe('back_in_contact');
      expect(await stateOf(journeyId), at).toBe('ACTIVE');
      const alerts = await alertsOf(journeyId);
      expect(
        alerts.map(({ state }) => state),
        at,
      ).toEqual(['RESOLVED']);
      const messages = await messagesOf(journeyId);
      expect(recipientsOf(ofKind(messages, 'BACK_IN_CONTACT')), at).toEqual(
        idsOf(responders).sort(),
      );
      const notices = ofKind(messages, 'ACKNOWLEDGED');
      expect(
        notices.filter(({ sentAt, withdrawnAt }) => sentAt === null && withdrawnAt === null),
        at,
      ).toEqual([]);
      if (acknowledged.status === 200) {
        expect(alerts[0]?.acknowledgedBy, at).toBe(r1.userId);
        expect(notices, at).toHaveLength(1);
        outcomes.add('acknowledged first');
      } else {
        expect(acknowledged, at).toMatchObject({ status: 409, body: { code: 'ALERT_RESOLVED' } });
        expect(alerts[0]?.acknowledgedBy, at).toBeNull();
        expect(notices, at).toEqual([]);
        outcomes.add('back in contact first');
      }
      expect((await watchdogFor().sweep()).opened, at).toBe(0);
      await connection().query("update journeys set state = 'ENDED' where id = $1", [journeyId]);
    }
    // Which orders the rounds fell into is the database's to decide; both are allowed.
    expect(outcomes.size).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
