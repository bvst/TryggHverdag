// L3 server integration: the escalation to SMS (LOST-07) on the real tables.
//
// The system tests prove the rule, the flows and the page against a fake
// store. What only a real PostgreSQL can prove is here:
//   - the flow, through the real adapter, the real modules and both recording
//     fakes (AC1, AC2);
//   - sweeps racing on separate connections (AC4);
//   - the escalation and "I'm on it" meeting on the journey's row, in each
//     order and at the same moment (AC5);
//   - all or nothing, with a test trigger that fails the second SMS (AC15);
//     and (SM-10-AC15, on Q3 (a)) a journey with no responder row, not
//     escalated, the sweep healthy, and counted unheard by the SMS check;
//   - a held row skipped at once, waited for once the alert's two minutes
//     passed 30 s ago, stuck when held through the wait, and a 55P03 on any
//     other lock a failure, never `held` (AC16);
//   - every time the database's now(), the alert and its SMS written by one
//     transaction, and the escalation time kept (AC17).
// The shared behaviour suite runs the store's side of AC1, AC3, AC4, AC6 to
// AC8, AC10 and AC14 to AC16 against the adapter in
// adapters/journeys.integration.test.ts; AC8's and AC19's tables are read
// there and in deploy.integration.test.ts.
//
// The alert's two minutes are reached by moving its opened_at back, relative
// to the database's own now(), not by waiting: the escalation reads the time
// the alert opened and the database's now(), nothing else.
//
// PostgreSQL 15, staging's version, as deploy.integration.test.ts explains.
// Needs Docker, like every *.integration.test.ts: CI's integration job runs
// it, a cloud session cannot.
//
// Each test starts from a quiet database: every journey a test left unended
// is ended, every alert left unresolved is resolved, and every message left
// due is put out of reach as sent, so a sweep or a claim here sees only what
// the test itself put in.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  RACE_ROUNDS,
  RACERS,
  apiPath,
  endTestPool,
  fakeLog,
  fakePush,
  fakeSms,
  fakeSmsAlarm,
  syntheticCredential,
  syntheticEventId,
  syntheticHeartbeat,
  syntheticUuid,
  type FakeLog,
  type FakePush,
  type FakeSms,
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
import { sqlstateOf } from './domain/sqlstate.ts';
import { LOCK_WAIT_LIMIT_MS } from './domain/watchdog.ts';
import { createAcknowledgementService } from './modules/alerts/acknowledgement.ts';
import { createPushSender, createSmsSender } from './modules/alerts/outbox.ts';
import { createSmsCheck } from './modules/alerts/sms-check.ts';
import { createWatchdog } from './modules/alerts/watchdog.ts';
import { createHealthService } from './modules/health/service.ts';
import { createJourneyService } from './modules/journeys/service.ts';

/** What Clever Cloud's DEV plan runs; see deploy.integration.test.ts. */
const STAGING_POSTGRES = 'postgres:15-alpine';

/** Enough connections that every racer holds its own. */
const CONNECTIONS = RACERS + 4;

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

/** Two minutes (D-019), written out so that a wrong ESCALATE_AFTER_MS fails here as well. */
const TWO_MINUTES = 2 * MINUTE;

/** Opened this long ago, an alert is due, and its two minutes passed less than 30 s ago. */
const DUE = TWO_MINUTES + 10 * SECOND;

/** Opened this long ago, an alert's two minutes passed 30 s ago or more (STUCK_AFTER_MS), with a margin. */
const PAST_STUCK = 3 * MINUTE;

/** How far past a wait the sweep may finish and still count as on time. */
const MARGIN = 2_500;

const QUIET = { ok: true, opened: 0, escalated: 0, stuck: 0 };
const ON_IT = { outcome: 'ACKNOWLEDGED' };
const SMS = 'LOST_CONTACT_SMS';

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
  await connection().query(
    "update alerts set state = 'RESOLVED', resolved_at = now(), resolution = 'HOME' " +
      "where state <> 'RESOLVED'",
  );
  await connection().query('update outbox set sent_at = now() where sent_at is null');
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

/** A pool of its own, named, with no lock limit, as the worker's is: the escalation bounds its own waits. */
function workerPool(applicationName: string, size = 2): pg.Pool {
  return createPool(withParameter(connectionUri(), 'application_name', applicationName), size);
}

/** A pool of its own, named, with the API's lock limit. */
function apiPool(applicationName: string, size = 2): pg.Pool {
  return createPool(withParameter(connectionUri(), 'application_name', applicationName), size, {
    lockTimeoutMs: LOCK_WAIT_LIMIT_MS,
  });
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

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

/** An ACTIVE journey of a new walker, put in directly with `responders` responders, silent for an hour. */
async function silent({ responders = 3 }: { responders?: number } = {}) {
  const walker = await person();
  const following: Person[] = [];
  for (let i = 0; i < responders; i += 1) {
    following.push(await person());
  }
  const journeyId = syntheticUuid();
  await connection().query(
    `insert into journeys (id, walker_id, device_id, state, started_at, last_heartbeat_at)
     values ($1, $2, $3, 'ACTIVE', now() - interval '2 hours', now() - interval '1 hour')`,
    [journeyId, walker.userId, walker.deviceId],
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

/** Moves the alert's opened_at to `ms` before the database's now(). */
async function openedAgo(alertId: string, ms: number): Promise<void> {
  await connection().query(
    `update alerts set opened_at = now() - ($2::double precision * interval '1 millisecond')
      where id = $1`,
    [alertId, ms],
  );
}

/** A lost journey whose alert opened `openedAgoMs` before now(): due, unless told otherwise. */
async function due({
  responders = 3,
  openedAgoMs = DUE,
}: { responders?: number; openedAgoMs?: number } = {}) {
  const journey = await lost({ responders });
  await openedAgo(journey.alertId, openedAgoMs);
  return journey;
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

/** The journey's alerts as the table holds them: who is on each, and when each escalated. */
async function alertsOf(journeyId: string) {
  const result = await connection().query<{
    id: string;
    state: string;
    opened_ms: string;
    resolved_ms: string | null;
    resolution: string | null;
    acknowledged_by: string | null;
    acknowledged_ms: string | null;
    sms_raised_ms: string | null;
    sms_raised_text: string | null;
  }>(
    `select id::text as id, state::text as state, ${MS('opened_at')} as opened_ms,
            ${MS('resolved_at')} as resolved_ms, resolution::text as resolution,
            acknowledged_by::text as acknowledged_by, ${MS('acknowledged_at')} as acknowledged_ms,
            ${MS('sms_raised_at')} as sms_raised_ms, sms_raised_at::text as sms_raised_text
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
    smsRaisedAt: numberOrNull(row.sms_raised_ms),
    /** sms_raised_at as PostgreSQL prints it, to the microsecond. */
    smsRaisedText: row.sms_raised_text,
  }));
}

async function messagesOf(journeyId: string) {
  const result = await connection().query<{
    message_id: string;
    alert_id: string;
    recipient_id: string;
    kind: string;
    attempts: number;
    created_text: string;
    next_text: string;
    sent_ms: string | null;
    withdrawn_ms: string | null;
    last_failure: string | null;
  }>(
    `select o.id::text as message_id, o.alert_id::text as alert_id,
            o.recipient_id::text as recipient_id, o.kind::text as kind,
            o.attempts::int as attempts, o.created_at::text as created_text,
            o.next_attempt_at::text as next_text,
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
    /** created_at as PostgreSQL prints it, to the microsecond. */
    createdText: row.created_text,
    /** next_attempt_at as PostgreSQL prints it, to the microsecond. */
    nextAttemptText: row.next_text,
    sentAt: numberOrNull(row.sent_ms),
    withdrawnAt: numberOrNull(row.withdrawn_ms),
    lastFailure: row.last_failure,
  }));
}

/** Everything the tables hold of a journey, its alerts and their messages, to compare before and after. */
async function recordOf(journeyId: string) {
  return {
    state: await stateOf(journeyId),
    alerts: await alertsOf(journeyId),
    messages: await messagesOf(journeyId),
  };
}

/**
 * The transaction that wrote the alert's row as it stands, and each of its
 * SMS messages' (PostgreSQL's xmin): one transaction writes them all, or they
 * show different ones.
 */
async function writersOf(alertId: string) {
  const alert = await connection().query<{ xmin: string }>(
    'select xmin::text as xmin from alerts where id = $1',
    [alertId],
  );
  const sms = await connection().query<{ xmin: string }>(
    `select xmin::text as xmin from outbox where alert_id = $1 and kind::text = $2
      order by recipient_id`,
    [alertId, SMS],
  );
  return { alert: alert.rows[0]?.xmin, sms: sms.rows.map(({ xmin }) => xmin) };
}

async function lastBeatMs(): Promise<number | null> {
  return (await databaseWorkerHeartbeats(database()).lastBeat())?.getTime() ?? null;
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
    await sleep(25);
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

/** A psql-like session of the test's own, holding one row `for update` in an open transaction, outside every pool. */
async function sessionHolding(table: 'journeys' | 'users', id: string) {
  const session = new pg.Client({ connectionString: connectionUri() });
  await session.connect();
  await session.query('begin');
  await session.query(`select id from ${table} where id = $1 for update`, [id]);
  const pid = (await session.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid;
  return {
    /** Whether another session is waiting for a lock this one holds. */
    waitedFor: async () => {
      const waiting = await connection().query<{ n: number }>(
        'select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
        [pid],
      );
      return (waiting.rows[0]?.n ?? 0) > 0;
    },
    commit: () => session.query('commit'),
    end: async () => {
      await session.query('rollback').catch(() => undefined);
      await session.end();
    },
  };
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
  const name = `lost07_hold_${table}_${event}`;
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

/** A test-only trigger that fails the insert of an alert's second LOST_CONTACT_SMS (AC15). */
function refuseASecondSms() {
  const name = 'lost07_refuse_a_second_sms';
  return {
    create: [
      `create function ${name}() returns trigger language plpgsql as $$
         begin
           if new.kind::text = '${SMS}'
              and exists (select 1 from outbox where alert_id = new.alert_id and kind = new.kind) then
             raise exception 'a second SMS refused by a test trigger' using errcode = 'P0001';
           end if;
           return new;
         end
       $$`,
      `create trigger ${name} before insert on outbox for each row execute function ${name}()`,
    ],
    drop: [`drop trigger if exists ${name} on outbox`, `drop function if exists ${name}()`],
  };
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

function pushSenderFor({ push = fakePush(), log = fakeLog() }: { push?: FakePush; log?: FakeLog }) {
  return createPushSender({ outbox: store(), push, log });
}

function smsSenderFor({ sms = fakeSms(), log = fakeLog() }: { sms?: FakeSms; log?: FakeLog }) {
  return createSmsSender({ outbox: store(), sms, log });
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

const recipientsOf = (messages: readonly { recipientId: string }[]) =>
  messages.map(({ recipientId }) => recipientId).sort();

const ofKind = <T extends { kind: string }>(messages: readonly T[], kind: string): T[] =>
  messages.filter((message) => message.kind === kind);

const idsOf = (people: readonly Person[]) => people.map(({ userId }) => userId);

/** The lines this task's events would write: the escalation's, the SMS sender's and the check's. */
const escalationLines = (log: FakeLog) =>
  log.events.filter(({ event }) => event.startsWith('escalation_') || event.startsWith('sms_'));

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
// LOST-07-AC1 and AC2: the flow, on the real tables.
// ---------------------------------------------------------------------------

describe('LOST-07, REL-07 and LOST-02: the escalation to SMS, on the real tables', () => {
  test('LOST-07-AC1: a journey started through the API with R1, R2 and R3, silent past five minutes, alerted by the real watchdog and push sender with R2’s push failing: under two minutes after the alert opened a sweep escalates nothing; at two minutes one sweep moves it to ESCALATED between two readings of now(), J still LOST_CONTACT with one alert; the SMS sender hands exactly one LOST_CONTACT_SMS to each of R1, R2 and R3 and to nobody else, the push port never one; later sweeps and deliveries add nothing', async () => {
    const api = realApi();
    const push = fakePush();
    const sms = fakeSms();
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
    push.failFor(r2.userId, 'NO_TARGET');
    expect(await watchdogFor({ log }).sweep()).toEqual({ ...QUIET, opened: 1 });
    await pushSenderFor({ push, log }).deliverDue();
    expect(recipientsOf(ofKind(push.accepted, 'LOST_CONTACT'))).toEqual(idsOf([r1, r3]).sort());
    const [opened] = await alertsOf(journeyId);
    const alertId = opened?.id ?? '';

    // Under two minutes: nothing.
    await openedAgo(alertId, TWO_MINUTES - 10 * SECOND);
    expect(await watchdogFor({ log }).sweep()).toEqual(QUIET);
    expect(await smsSenderFor({ sms, log }).deliverDue()).toEqual({ sent: 0, failed: 0 });
    expect((await alertsOf(journeyId))[0]).toMatchObject({ state: 'OPEN', smsRaisedAt: null });
    expect(sms.messages).toEqual([]);

    // Two minutes: escalated, on the database's clock.
    await openedAgo(alertId, TWO_MINUTES);
    const before = await databaseNowMs();
    const swept = await watchdogFor({ log }).sweep();
    const after = await databaseNowMs();

    expect(swept).toEqual({ ...QUIET, escalated: 1 });
    const [alert, ...others] = await alertsOf(journeyId);
    expect(others).toEqual([]);
    expect(alert).toMatchObject({ id: alertId, state: 'ESCALATED' });
    expect(alert?.smsRaisedAt).toBeGreaterThanOrEqual(before);
    expect(alert?.smsRaisedAt).toBeLessThanOrEqual(after);
    expect(await stateOf(journeyId)).toBe('LOST_CONTACT');

    expect(await smsSenderFor({ sms, log }).deliverDue()).toEqual({ sent: 3, failed: 0 });
    expect(sms.messages.map(({ kind }) => kind)).toEqual([SMS, SMS, SMS]);
    expect(recipientsOf(sms.accepted)).toEqual(idsOf([r1, r2, r3]).sort());
    await pushSenderFor({ push, log }).deliverDue();

    // Later sweeps and deliveries add nothing, by SMS or by push.
    expect(await watchdogFor({ log }).sweep()).toEqual(QUIET);
    expect(await smsSenderFor({ sms, log }).deliverDue()).toEqual({ sent: 0, failed: 0 });
    expect(sms.messages).toHaveLength(3);
    expect(recipientsOf(sms.messages)).not.toContain(walker.userId);
    expect(push.messages.filter(({ kind }) => kind === SMS)).toEqual([]);
    // R2's one push is retried as it fails, under its own ID: never a second message.
    expect(new Set(push.messages.map(({ messageId }) => messageId)).size).toBe(3);
    const messages = await messagesOf(journeyId);
    expect(messages).toHaveLength(6);
    expect(recipientsOf(ofKind(messages, 'LOST_CONTACT'))).toEqual(idsOf([r1, r2, r3]).sort());
    expect(recipientsOf(ofKind(messages, SMS))).toEqual(idsOf([r1, r2, r3]).sort());
    expect(escalationLines(log)).toEqual([]);
  });

  test('LOST-07-AC2: R1’s "I’m on it" through the API a minute after the alert opened: with the alert then opened ten minutes before now(), sweeps escalate nothing, no SMS is written or handed over, and the alert stays ACKNOWLEDGED by R1 with no escalation time', async () => {
    const { journeyId, alertId, responders } = await lost({ responders: 3 });
    const [r1] = responders as [Person, Person, Person];
    const sms = fakeSms();
    const log = fakeLog();
    await openedAgo(alertId, MINUTE);
    expect(await acknowledge(realApi(), r1.credential, alertId)).toEqual({
      status: 200,
      body: ON_IT,
    });

    await openedAgo(alertId, 10 * MINUTE);
    expect(await watchdogFor({ log }).sweep()).toEqual(QUIET);
    expect(await watchdogFor({ log }).sweep()).toEqual(QUIET);
    expect(await smsSenderFor({ sms, log }).deliverDue()).toEqual({ sent: 0, failed: 0 });

    expect(sms.messages).toEqual([]);
    expect(ofKind(await messagesOf(journeyId), SMS)).toEqual([]);
    expect((await alertsOf(journeyId))[0]).toMatchObject({
      state: 'ACKNOWLEDGED',
      acknowledgedBy: r1.userId,
      smsRaisedAt: null,
    });
    expect(escalationLines(log)).toEqual([]);
  });

  test('LOST-07-AC6: through the API on the real tables, a stranger learns nothing of an ESCALATED alert and stops nothing, since only the journey’s own responders may see it or stop it: W’s own device, another walker and a responder of another journey only each get, status, body and headers byte for byte, the 404 an alert ID no alert has gets; no acknowledgement_ignored line is written; every SMS stays unwithdrawn, and is then delivered', async () => {
    // LOST-07 review loop 1 (privacy-security-reviewer), as the L6 test holds
    // it: "not a responder" comes before every state, ESCALATED included.
    const { walker, journeyId, alertId, responders } = await due({ responders: 3 });
    const [r1] = responders as [Person, Person, Person];
    expect(await watchdogFor().sweep()).toEqual({ ...QUIET, escalated: 1 });
    const otherWalker = await person();
    const elsewhere = await silent({ responders: 1 });
    const [theirResponder] = elsewhere.responders as [Person];
    const log = fakeLog();
    const api = realApi({ log });
    const noAlert = await acknowledgeAsSent(api, r1.credential, syntheticUuid());
    expect(noAlert.status).toBe(404);
    expect(parsedOrNull(noAlert.text)).toMatchObject({ code: 'ALERT_NOT_FOUND' });
    const before = await recordOf(journeyId);

    for (const [who, credential] of [
      ['W’s own device', walker.credential],
      ['another walker', otherWalker.credential],
      ['a responder of another journey only', theirResponder.credential],
    ] as const) {
      expect(await acknowledgeAsSent(api, credential, alertId), who).toEqual(noAlert);
    }

    expect(log.events).toEqual([]);
    expect(await recordOf(journeyId)).toEqual(before);
    const written = ofKind(await messagesOf(journeyId), SMS);
    expect(written.map(({ withdrawnAt }) => withdrawnAt)).toEqual([null, null, null]);
    const sms = fakeSms();
    expect(await smsSenderFor({ sms }).deliverDue()).toEqual({ sent: 3, failed: 0 });
    expect(recipientsOf(sms.accepted)).toEqual(idsOf(responders).sort());
  });
});

// ---------------------------------------------------------------------------
// LOST-07-AC4: swept by many at once.
// ---------------------------------------------------------------------------

describe('LOST-07 and AR-06: an alert is escalated once, whoever sweeps', () => {
  test(`LOST-07-AC4: ${String(RACERS)} watchdogs sweeping a due alert at once on separate connections, ${String(RACE_ROUNDS)} times over: exactly one escalates it and every other escalates nothing, none failing; one escalation time; each responder holds exactly one LOST_CONTACT push and one LOST_CONTACT_SMS for the alert, through a later sweep too`, async () => {
    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const at = `round ${String(round)}`;
      const { journeyId, responders } = await due({ responders: 3 });

      const results = await Promise.all(
        Array.from({ length: RACERS }, () => watchdogFor().sweep()),
      );

      expect(
        results.filter(({ ok }) => !ok),
        at,
      ).toEqual([]);
      expect(results.map(({ escalated }) => escalated).sort(), at).toEqual([
        ...Array.from({ length: RACERS - 1 }, () => 0),
        1,
      ]);
      expect(await watchdogFor().sweep(), at).toEqual(QUIET);
      const alerts = await alertsOf(journeyId);
      expect(
        alerts.map(({ state }) => state),
        at,
      ).toEqual(['ESCALATED']);
      expect(alerts[0]?.smsRaisedAt, at).not.toBeNull();
      const messages = await messagesOf(journeyId);
      expect(messages, at).toHaveLength(2 * responders.length);
      for (const { userId } of responders) {
        expect(
          messages
            .filter(({ recipientId }) => recipientId === userId)
            .map(({ kind }) => kind)
            .sort(),
          at,
        ).toEqual(['LOST_CONTACT', SMS]);
      }
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// LOST-07-AC5: the escalation and "I'm on it" meet on the journey's row.
// ---------------------------------------------------------------------------

describe('LOST-07, LOST-06 and SM-09: the escalation and "I’m on it" meet on the journey’s row', () => {
  test('LOST-07-AC5: with an acknowledgement’s transaction holding J’s row before commit, the sweep’s waiting attempt waits for the row (pg_stat_activity), then finds the alert acknowledged and writes nothing: the sweep ok, no SMS, the alert ACKNOWLEDGED by R1 with no escalation time', async () => {
    const { journeyId, alertId, responders } = await due({
      responders: 2,
      openedAgoMs: PAST_STUCK,
    });
    const [r1] = responders as [Person, Person];
    const tag = 'lost07_ac5_sweep';
    const sweepPool = workerPool(tag);
    const log = fakeLog();
    const held = await gate();
    let swept: unknown;
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
          const sweeping = watchdogFor({ database: createDatabase(sweepPool), log }).sweep();
          sweeping.catch(() => undefined);
          expect(await eventually(async () => (await waitingOnALock(tag)) === 1)).toBe(true);

          await held.open();
          expect(await acknowledging).toEqual({ status: 200, body: ON_IT });
          swept = await bounded(sweeping, LOCK_WAIT_LIMIT_MS + MARGIN);
        } finally {
          await held.open();
        }
      });
    } finally {
      await held.end();
      await endTestPool(sweepPool);
    }

    expect(swept).toEqual(QUIET);
    expect(await alertsOf(journeyId)).toEqual([
      expect.objectContaining({
        state: 'ACKNOWLEDGED',
        acknowledgedBy: r1.userId,
        smsRaisedAt: null,
      }),
    ]);
    expect(ofKind(await messagesOf(journeyId), SMS)).toEqual([]);
    expect(escalationLines(log)).toEqual([]);
  }, 30_000);

  test('LOST-07-AC5: with the escalation’s transaction holding J’s row before commit, R1’s acknowledgement past its read waits for the row (pg_stat_activity), then records R1, keeps the escalation time, and withdraws every SMS the escalation wrote at its own now(); the SMS sender then hands none over', async () => {
    const { journeyId, alertId, responders } = await due({ responders: 3 });
    const [r1, r2, r3] = responders as [Person, Person, Person];
    const tag = 'lost07_ac5_acknowledgement';
    const ackPool = apiPool(tag);
    const sms = fakeSms();
    const log = fakeLog();
    const held = await gate();
    let swept: unknown;
    try {
      const { create, drop } = holdBehind(
        held.key,
        'outbox',
        'insert',
        `new.kind::text = '${SMS}'`,
      );
      await withTrigger(create, drop, async () => {
        const sweeping = watchdogFor({ log }).sweep();
        sweeping.catch(() => undefined);
        try {
          expect(await eventually(someoneAtTheGate)).toBe(true);
          const acknowledging = acknowledge(
            realApi({ database: createDatabase(ackPool) }),
            r1.credential,
            alertId,
          );
          acknowledging.catch(() => undefined);
          expect(await eventually(async () => (await waitingOnALock(tag)) === 1)).toBe(true);

          await held.open();
          swept = await sweeping;
          expect(await acknowledging).toEqual({ status: 200, body: ON_IT });
        } finally {
          await held.open();
        }
      });
    } finally {
      await held.end();
      await endTestPool(ackPool);
    }

    expect(swept).toEqual({ ...QUIET, escalated: 1 });
    const [alert] = await alertsOf(journeyId);
    expect(alert).toMatchObject({ state: 'ACKNOWLEDGED', acknowledgedBy: r1.userId });
    expect(alert?.smsRaisedAt).not.toBeNull();
    const messages = await messagesOf(journeyId);
    const written = ofKind(messages, SMS);
    expect(recipientsOf(written)).toEqual(idsOf([r1, r2, r3]).sort());
    expect(
      written.map(({ sentAt, withdrawnAt, attempts }) => ({ sentAt, withdrawnAt, attempts })),
    ).toEqual(
      written.map(() => ({ sentAt: null, withdrawnAt: alert?.acknowledgedAt, attempts: 0 })),
    );
    expect(recipientsOf(ofKind(messages, 'ACKNOWLEDGED'))).toEqual(idsOf([r2, r3]).sort());
    expect(await smsSenderFor({ sms, log }).deliverDue()).toEqual({ sent: 0, failed: 0 });
    expect(sms.messages).toEqual([]);
  }, 30_000);

  test(`LOST-07-AC5: an acknowledgement and a sweep starting at the same moment on separate connections, ${String(2 * RACE_ROUNDS)} rounds: every round ends with the alert ACKNOWLEDGED by R1 and either escalated first, every SMS withdrawn, or acknowledged first, no SMS and no escalation time; never an SMS unsent and unwithdrawn on an alert acknowledged by someone`, async () => {
    const api = realApi();
    const outcomes = new Set<string>();
    for (let round = 0; round < 2 * RACE_ROUNDS; round += 1) {
      const at = `round ${String(round)}`;
      const { journeyId, alertId, responders } = await due({ responders: 2 });
      const [r1] = responders as [Person, Person];

      const [acknowledged, swept] = await Promise.all([
        acknowledge(api, r1.credential, alertId),
        watchdogFor().sweep(),
      ]);

      expect(acknowledged, at).toEqual({ status: 200, body: ON_IT });
      expect(swept.ok, at).toBe(true);
      const [alert] = await alertsOf(journeyId);
      expect(alert, at).toMatchObject({ state: 'ACKNOWLEDGED', acknowledgedBy: r1.userId });
      const written = ofKind(await messagesOf(journeyId), SMS);
      expect(
        written.filter(({ sentAt, withdrawnAt }) => sentAt === null && withdrawnAt === null),
        at,
      ).toEqual([]);
      if (alert?.smsRaisedAt === null) {
        expect(written, at).toEqual([]);
        expect(swept.escalated, at).toBe(0);
        outcomes.add('acknowledged first');
      } else {
        expect(recipientsOf(written), at).toEqual(idsOf(responders).sort());
        expect(swept.escalated, at).toBe(1);
        outcomes.add('escalated first');
      }
    }
    // Which orders the rounds fell into is the database's to decide; both are allowed.
    expect(outcomes.size).toBeGreaterThanOrEqual(1);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// LOST-07-AC15: all or nothing.
// ---------------------------------------------------------------------------

describe('LOST-07 and AR-05: an escalation is all or nothing', () => {
  test('LOST-07-AC15: with a test trigger refusing the alert’s second LOST_CONTACT_SMS, the sweep fails with one escalation_failed line, stage escalate and the SQLSTATE, and records no beat; nothing changed: the alert OPEN with no escalation time, no SMS; without the trigger, the next sweep escalates and does all of AC1’s work', async () => {
    const { journeyId, alertId, responders } = await due({ responders: 3 });
    const log = fakeLog();
    const before = await recordOf(journeyId);
    const beatBefore = await lastBeatMs();
    const { create, drop } = refuseASecondSms();

    await withTrigger(create, drop, async () => {
      expect(await watchdogFor({ log }).sweep()).toEqual({ ...QUIET, ok: false });
      expect(log.events).toEqual([
        { event: 'escalation_failed', stage: 'escalate', code: 'P0001' },
      ]);
      expect(await recordOf(journeyId)).toEqual(before);
      expect(before.alerts.map(({ state, smsRaisedAt }) => [state, smsRaisedAt])).toEqual([
        ['OPEN', null],
      ]);
      expect(ofKind(before.messages, SMS)).toEqual([]);
      expect(await lastBeatMs()).toBe(beatBefore);
    });

    const beforeSweep = await databaseNowMs();
    expect(await watchdogFor({ log }).sweep()).toEqual({ ...QUIET, escalated: 1 });
    expect((await alertsOf(journeyId))[0]).toMatchObject({ id: alertId, state: 'ESCALATED' });
    expect(recipientsOf(ofKind(await messagesOf(journeyId), SMS))).toEqual(
      idsOf(responders).sort(),
    );
    expect(await lastBeatMs()).toBeGreaterThanOrEqual(beforeSweep);
  });

  test('SM-10-AC15: an alert whose journey has no responder row, put there directly, is not escalated: never read as due, so skipped, writing nothing; the sweep ok, with its beat; and the SMS check counts it unheard, reporting failing with one unheard_alerts line, count 1 (LOST-07, SM-02)', async () => {
    // RG-03, named in SM-10's spec ("Existing assertions that change by
    // design", the no-responder refusals, on Q3 (a), D-122 item 3). This was
    // "LOST-07-AC15: an alert whose journey has no responder row, put there
    // directly, is not escalated: the escalation is refused whole, the sweep
    // fails saying so in one escalation_failed line, stage escalate, and
    // records no beat". The alert is still not escalated and nothing of it
    // changes, as the old test held; but the sweep now stays healthy and
    // records its beat, and the owner is paged through the SMS check.
    const { journeyId } = await due({ responders: 2 });
    await connection().query('delete from journey_responders where journey_id = $1', [journeyId]);
    const log = fakeLog();
    const alarm = fakeSmsAlarm();
    const before = await recordOf(journeyId);

    const beforeSweep = await databaseNowMs();
    const swept = await watchdogFor({ log }).sweep();

    expect(swept).toEqual(QUIET);
    expect(log.events).toEqual([]);
    expect(await recordOf(journeyId)).toEqual(before);
    expect(before.alerts.map(({ state, smsRaisedAt }) => [state, smsRaisedAt])).toEqual([
      ['OPEN', null],
    ]);
    expect(await lastBeatMs()).toBeGreaterThanOrEqual(beforeSweep);

    expect(await createSmsCheck({ outbox: store(), alarm, log }).check()).toBe('failing');
    expect(alarm.statuses).toEqual(['failing']);
    expect(log.events).toEqual([{ event: 'unheard_alerts', count: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// SM-10-AC15: the unheard count, on the real tables (Q3 (a)).
// ---------------------------------------------------------------------------

describe('SM-10, SM-02 and LOST-07: the SMS check counts the alerts nobody can hear, on the real tables', () => {
  /** A lost journey whose responder rows are then deleted, put there directly: its alert unheard. */
  async function unheard({ state }: { state?: 'ACKNOWLEDGED' | 'ESCALATED' } = {}) {
    const journey = await lost({ responders: 2 });
    if (state === 'ESCALATED') {
      await connection().query(
        "update alerts set state = 'ESCALATED', sms_raised_at = now() where id = $1",
        [journey.alertId],
      );
    }
    if (state === 'ACKNOWLEDGED') {
      await connection().query(
        `update alerts set state = 'ACKNOWLEDGED', acknowledged_by = $2, acknowledged_at = now()
          where id = $1`,
        [journey.alertId, journey.responders[0]?.userId],
      );
    }
    await connection().query('delete from journey_responders where journey_id = $1', [
      journey.journeyId,
    ]);
    return journey;
  }

  test('SM-10-AC15: unheardAlertCount reads exactly the unresolved alerts whose journey has no responder row, whatever their state, with the database’s now() between two readings; an alert with a responder, and a resolved one with none, count nothing (SM-02, LOST-07)', async () => {
    const count = async (what: string) => {
      const before = await databaseNowMs();
      const read = await store().unheardAlertCount();
      const after = await databaseNowMs();
      expect(read.now.getTime(), what).toBeGreaterThanOrEqual(before);
      expect(read.now.getTime(), what).toBeLessThanOrEqual(after);
      return read.count;
    };
    expect(await count('a quiet database')).toBe(0);

    await unheard();
    expect(await count('one OPEN')).toBe(1);
    await unheard({ state: 'ESCALATED' });
    await unheard({ state: 'ACKNOWLEDGED' });
    expect(await count('one each of OPEN, ESCALATED and ACKNOWLEDGED')).toBe(3);

    // Not counted: an alert whose journey has a responder, and a RESOLVED
    // alert whose journey has none.
    await lost({ responders: 1 });
    const over = await unheard();
    await connection().query(
      "update alerts set state = 'RESOLVED', resolved_at = now(), resolution = 'BACK_IN_CONTACT' where id = $1",
      [over.alertId],
    );
    expect(await count('one heard, one over')).toBe(3);
  });

  test('SM-10-AC15: the SMS check reports failing while an unheard alert is unresolved, with one unheard_alerts line holding the count; once contact brings it back, resolving it with no stand-down, the next check reports ok and writes no line (SM-02, LOST-07)', async () => {
    const journey = await unheard();
    const log = fakeLog();
    const alarm = fakeSmsAlarm();
    const check = createSmsCheck({ outbox: store(), alarm, log });

    expect(await check.check()).toBe('failing');
    expect(log.events).toEqual([{ event: 'unheard_alerts', count: 1 }]);

    const recorded = await store().recordHeartbeat(await freshHeartbeat(journey.journeyId));
    expect(recorded).toEqual({
      outcome: 'back_in_contact',
      alertId: journey.alertId,
      messages: [],
    });
    expect((await alertsOf(journey.journeyId)).map(({ state }) => state)).toEqual(['RESOLVED']);
    expect(ofKind(await messagesOf(journey.journeyId), 'BACK_IN_CONTACT')).toEqual([]);

    expect(await check.check()).toBe('ok');
    expect(alarm.statuses).toEqual(['failing', 'ok']);
    expect(log.events).toEqual([{ event: 'unheard_alerts', count: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// LOST-07-AC16: a held row never hides an escalation.
// ---------------------------------------------------------------------------

describe('LOST-07, AR-06 and D-108: a held row never hides an escalation', () => {
  test('LOST-07-AC16: J’s due alert, under 30 s past its two minutes, with J’s row held by another transaction: the sweep skips it without waiting and is ok; once the holder lets go, the next sweep escalates it', async () => {
    const { journeyId } = await due({ responders: 2 });
    const log = fakeLog();
    const holder = await sessionHolding('journeys', journeyId);
    try {
      const started = performance.now();
      expect(await watchdogFor({ log }).sweep()).toEqual(QUIET);
      expect(performance.now() - started).toBeLessThan(SECOND);
      expect((await alertsOf(journeyId))[0]).toMatchObject({ state: 'OPEN', smsRaisedAt: null });
      expect(ofKind(await messagesOf(journeyId), SMS)).toEqual([]);
    } finally {
      await holder.end();
    }

    expect(await watchdogFor({ log }).sweep()).toEqual({ ...QUIET, escalated: 1 });
    expect((await alertsOf(journeyId))[0]).toMatchObject({ state: 'ESCALATED' });
    expect(escalationLines(log)).toEqual([]);
  });

  test('LOST-07-AC16: J’s alert 30 s or more past its two minutes, with J’s row held by a session that never lets go: the sweep’s waiting attempt waits for the row (pg_stat_activity), at least LOCK_WAIT_LIMIT_MS and less than it plus a margin; one escalation_overdue line names the alert, the sweep fails and records no beat; once the hold ends the next sweep escalates it and records the beat', async () => {
    const { journeyId, alertId } = await due({ responders: 2, openedAgoMs: PAST_STUCK });
    const tag = 'lost07_ac16_stuck';
    const sweepPool = workerPool(tag);
    const log = fakeLog();
    const beatBefore = await lastBeatMs();
    const holder = await sessionHolding('journeys', journeyId);
    let stuck: unknown;
    let tookMs: number;
    try {
      const started = performance.now();
      const sweeping = watchdogFor({ database: createDatabase(sweepPool), log }).sweep();
      sweeping.catch(() => undefined);
      expect(await eventually(async () => (await waitingOnALock(tag)) === 1)).toBe(true);
      stuck = await bounded(sweeping, LOCK_WAIT_LIMIT_MS + MARGIN);
      tookMs = performance.now() - started;
    } finally {
      await holder.end();
      await endTestPool(sweepPool);
    }

    expect(stuck).toEqual({ ...QUIET, ok: false, stuck: 1 });
    expect(tookMs).toBeGreaterThanOrEqual(LOCK_WAIT_LIMIT_MS);
    expect(tookMs).toBeLessThan(LOCK_WAIT_LIMIT_MS + MARGIN);
    expect(log.events).toEqual([{ event: 'escalation_overdue', alertId }]);
    expect(await lastBeatMs()).toBe(beatBefore);
    expect((await alertsOf(journeyId))[0]).toMatchObject({ state: 'OPEN', smsRaisedAt: null });
    expect(ofKind(await messagesOf(journeyId), SMS)).toEqual([]);

    const beforeSweep = await databaseNowMs();
    expect(await watchdogFor({ log }).sweep()).toEqual({ ...QUIET, escalated: 1 });
    expect((await alertsOf(journeyId))[0]).toMatchObject({ state: 'ESCALATED' });
    expect(await lastBeatMs()).toBeGreaterThanOrEqual(beforeSweep);
  }, 30_000);

  test.each(['an acknowledgement', 'a heartbeat that brings contact back'] as const)(
    'LOST-07-AC16: J’s alert 30 s or more past its two minutes, with J’s row held by %s committing within the wait: the waiting attempt waits for the row (pg_stat_activity), then finds the alert as the holder left it and writes nothing; the sweep ok, no SMS, no escalation time',
    async (holder) => {
      const { journeyId, alertId, responders } = await due({
        responders: 2,
        openedAgoMs: PAST_STUCK,
      });
      const [r1] = responders as [Person, Person];
      const tag = 'lost07_ac16_holder';
      const sweepPool = workerPool(tag);
      const log = fakeLog();
      const held = await gate();
      let swept: unknown;
      try {
        const leftAs = holder === 'an acknowledgement' ? 'ACKNOWLEDGED' : 'RESOLVED';
        const { create, drop } = holdBehind(
          held.key,
          'alerts',
          'update',
          `new.state = '${leftAs}'`,
        );
        await withTrigger(create, drop, async () => {
          const holding =
            holder === 'an acknowledgement'
              ? acknowledge(realApi(), r1.credential, alertId)
              : store().recordHeartbeat(await freshHeartbeat(journeyId));
          holding.catch(() => undefined);
          try {
            expect(await eventually(someoneAtTheGate)).toBe(true);
            const sweeping = watchdogFor({ database: createDatabase(sweepPool), log }).sweep();
            sweeping.catch(() => undefined);
            expect(await eventually(async () => (await waitingOnALock(tag)) === 1)).toBe(true);

            await held.open();
            await holding;
            swept = await bounded(sweeping, LOCK_WAIT_LIMIT_MS + MARGIN);
          } finally {
            await held.open();
          }
        });
      } finally {
        await held.end();
        await endTestPool(sweepPool);
      }

      expect(swept).toEqual(QUIET);
      const [alert] = await alertsOf(journeyId);
      expect(alert).toMatchObject(
        holder === 'an acknowledgement'
          ? { state: 'ACKNOWLEDGED', acknowledgedBy: r1.userId, smsRaisedAt: null }
          : { state: 'RESOLVED', resolution: 'BACK_IN_CONTACT', smsRaisedAt: null },
      );
      expect(ofKind(await messagesOf(journeyId), SMS)).toEqual([]);
      expect(escalationLines(log)).toEqual([]);
    },
    30_000,
  );

  test('LOST-07-AC16: J’s alert 30 s or more past its two minutes, with J’s row held by a transaction that commits within the wait without changing it: the waiting attempt waits for the row (pg_stat_activity), then escalates; the sweep ok and not stuck', async () => {
    const { journeyId, responders } = await due({ responders: 2, openedAgoMs: PAST_STUCK });
    const tag = 'lost07_ac16_unchanged';
    const sweepPool = workerPool(tag);
    const log = fakeLog();
    const holder = await sessionHolding('journeys', journeyId);
    let swept: unknown;
    try {
      const sweeping = watchdogFor({ database: createDatabase(sweepPool), log }).sweep();
      sweeping.catch(() => undefined);
      expect(await eventually(async () => (await waitingOnALock(tag)) === 1)).toBe(true);
      await holder.commit();
      swept = await bounded(sweeping, LOCK_WAIT_LIMIT_MS + MARGIN);
    } finally {
      await holder.end();
      await endTestPool(sweepPool);
    }

    expect(swept).toEqual({ ...QUIET, escalated: 1 });
    expect((await alertsOf(journeyId))[0]).toMatchObject({ state: 'ESCALATED' });
    expect(recipientsOf(ofKind(await messagesOf(journeyId), SMS))).toEqual(
      idsOf(responders).sort(),
    );
    expect(escalationLines(log)).toEqual([]);
  }, 30_000);

  test('LOST-07-AC16: a waiting escalation that takes the journey’s row within the wait, then runs out of time on a responder’s users row, fails with 55P03 and writes nothing; it never answers held', async () => {
    const { journeyId, alertId, responders } = await due({ responders: 1 });
    const [r1] = responders as [Person];
    const rowHolder = await sessionHolding('journeys', journeyId);
    const userHolder = await sessionHolding('users', r1.userId);
    const lockWaitMs = 1_000;
    let outcome: unknown;
    try {
      // RG-03 (LOST-07 review loop 1, `code-reviewer`): no afterMs; the
      // adapter decides by the domain's two minutes, whoever asks.
      const escalating = store()
        .escalateAlert({ alertId, lockWaitMs })
        .then(
          (answer) => ({ answer }),
          (error: unknown) => ({ error }),
        );
      // The escalation waits for the journey's row; its holder lets go within
      // the wait, and the escalation takes it, then waits for the users row
      // its SMS references, which is held for good.
      expect(await eventually(() => rowHolder.waitedFor())).toBe(true);
      await rowHolder.commit();
      outcome = await bounded(escalating, 3 * lockWaitMs + 2_000);
    } finally {
      await rowHolder.end();
      await userHolder.end();
    }

    expect(outcome).not.toEqual({ answer: { outcome: 'held' } });
    const failed = outcome as { error?: unknown };
    expect(failed.error, JSON.stringify(outcome)).toBeInstanceOf(Error);
    expect(sqlstateOf(failed.error)).toBe('55P03');
    expect((await alertsOf(journeyId))[0]).toMatchObject({ state: 'OPEN', smsRaisedAt: null });
    expect(ofKind(await messagesOf(journeyId), SMS)).toEqual([]);
  }, 30_000);

  test('LOST-07-AC16: with a responder’s users row held for ever and the alert under 30 s past its two minutes, the sweep fails within LOCK_WAIT_LIMIT_MS plus a margin with one escalation_failed line, stage escalate, code 55P03, is not stuck, and records no beat', async () => {
    const { journeyId, responders } = await due({ responders: 2 });
    const [r1] = responders as [Person, Person];
    const log = fakeLog();
    const beatBefore = await lastBeatMs();
    const holder = await sessionHolding('users', r1.userId);
    let swept: unknown;
    try {
      swept = await bounded(watchdogFor({ log }).sweep(), LOCK_WAIT_LIMIT_MS + MARGIN);
    } finally {
      await holder.end();
    }

    expect(swept).toEqual({ ...QUIET, ok: false });
    expect(log.events).toEqual([{ event: 'escalation_failed', stage: 'escalate', code: '55P03' }]);
    expect(await lastBeatMs()).toBe(beatBefore);
    expect((await alertsOf(journeyId))[0]).toMatchObject({ state: 'OPEN', smsRaisedAt: null });
    expect(ofKind(await messagesOf(journeyId), SMS)).toEqual([]);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// LOST-07-AC17: the escalation's time is the database's.
// ---------------------------------------------------------------------------

describe('LOST-07 and REL-01: the escalation’s time is the database’s', () => {
  test('LOST-07-AC17: sms_raised_at lies between two readings of now() taken before and after the sweep, never before opened_at plus 120 s; each SMS’s created_at and next_attempt_at equal it to the microsecond, written by the same transaction (xmin); an acknowledgement, then a heartbeat that resolves the alert, keep it', async () => {
    const { journeyId, alertId, responders } = await due({ responders: 3 });
    const [r1] = responders as [Person, Person, Person];

    const before = await databaseNowMs();
    expect(await watchdogFor().sweep()).toEqual({ ...QUIET, escalated: 1 });
    const after = await databaseNowMs();

    const [alert] = await alertsOf(journeyId);
    expect(alert?.smsRaisedAt).toBeGreaterThanOrEqual(before);
    expect(alert?.smsRaisedAt).toBeLessThanOrEqual(after);
    expect(alert?.smsRaisedAt).toBeGreaterThanOrEqual((alert?.openedAt ?? 0) + TWO_MINUTES);
    const written = ofKind(await messagesOf(journeyId), SMS);
    expect(written).toHaveLength(3);
    for (const message of written) {
      expect(message.createdText, 'the SMS’s created_at').toBe(alert?.smsRaisedText);
      expect(message.nextAttemptText, 'the SMS’s next_attempt_at').toBe(alert?.smsRaisedText);
    }
    const writers = await writersOf(alertId);
    expect(writers.alert).toBeDefined();
    expect(writers.sms).toEqual([writers.alert, writers.alert, writers.alert]);

    expect(await acknowledge(realApi(), r1.credential, alertId)).toEqual({
      status: 200,
      body: ON_IT,
    });
    expect((await alertsOf(journeyId))[0]).toMatchObject({
      state: 'ACKNOWLEDGED',
      smsRaisedText: alert?.smsRaisedText,
    });

    expect((await store().recordHeartbeat(await freshHeartbeat(journeyId))).outcome).toBe(
      'back_in_contact',
    );
    expect((await alertsOf(journeyId))[0]).toMatchObject({
      state: 'RESOLVED',
      smsRaisedText: alert?.smsRaisedText,
    });
  });
});
