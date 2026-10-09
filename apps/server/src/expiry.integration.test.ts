// L3 server integration: the 24-hour end (LOST-08, SM-06's third end) on
// the real tables.
//
// The system tests prove the rule, the sweep's order and its failures against
// a fake store. What only a real PostgreSQL can prove is here:
//   - the 24 hours counted by the expiring transaction's now() against
//     opened_at, and every time that now(), in one transaction (AC8, AC17);
//     an unheard alert resolved, with no message (AC9);
//   - the 24-hour end deciding under the journey's row against contact back,
//     "I'm home", a close and a removal, in both orders, each seen waiting in
//     pg_stat_activity, and a row held through its wait (AC11);
//   - all or nothing, with a test trigger refusing each write in turn (AC16).
// The shared behaviour suite runs the store's side of AC8, AC9, AC11 and AC6
// against the adapter in adapters/journeys.integration.test.ts.
//
// PostgreSQL 15, staging's version, as deploy.integration.test.ts explains.
// Needs Docker, like every *.integration.test.ts: CI's integration job runs
// it, a cloud session cannot.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  RACERS,
  apiPath,
  endTestPool,
  fakeLog,
  syntheticCredential,
  syntheticEventId,
  syntheticUuid,
  type FakeLog,
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
import { ALERT_EXPIRES_AFTER_MS, LOST_CONTACT_AFTER_MS } from './domain/journey.ts';
import { LOCK_WAIT_LIMIT_MS } from './domain/watchdog.ts';
import { createAcknowledgementService } from './modules/alerts/acknowledgement.ts';
import { createClosureService } from './modules/alerts/closure.ts';
import { createWatchdog } from './modules/alerts/watchdog.ts';
import { createHealthService } from './modules/health/service.ts';
import { createRemovalService } from './modules/journeys/removal.ts';
import { createJourneyService } from './modules/journeys/service.ts';

/** What Clever Cloud's DEV plan runs; see deploy.integration.test.ts. */
const STAGING_POSTGRES = 'postgres:15-alpine';

/** Enough connections that every racer holds its own. */
const CONNECTIONS = RACERS + 4;

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** SM-06 (D-126): 24 hours, written out; the domain's constant is held to it below. */
const A_DAY = 24 * HOUR;
/** How far past its 24 hours an alert is stuck (D-116): the sweep then waits for its row once. */
const STUCK_AFTER = 30 * SECOND;
/** How much longer than the lock limit a wait may take here before it counts as never ending. */
const MARGIN = 2_500;

const QUIET = { ok: true, opened: 0, escalated: 0, stuck: 0 };
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
  // A quiet database for each test: every journey left unended ended, every
  // alert left unresolved resolved as "I'm home" would have resolved it, and
  // every message left due put out of reach as sent, so a sweep or a claim
  // here sees only what the test itself put in.
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

/** A pool of its own, named, with the API's lock limit, so a test can see in pg_stat_activity what its sessions wait for. */
function apiPool(applicationName: string, size = 2): pg.Pool {
  return createPool(withParameter(connectionUri(), 'application_name', applicationName), size, {
    lockTimeoutMs: LOCK_WAIT_LIMIT_MS,
  });
}

/** A pool of its own, named, with no lock limit, as the worker's is: the 24-hour end bounds its own waits. */
function workerPool(applicationName: string, size = 2): pg.Pool {
  return createPool(withParameter(connectionUri(), 'application_name', applicationName), size);
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
 * responders, each with a device of their own: started two hours before
 * now(), and last heard from an hour before now().
 */
async function silent({ responders = 3 }: { responders?: number } = {}) {
  const walker = await person();
  const following: Person[] = [];
  for (let i = 0; i < responders; i += 1) {
    following.push(await person());
  }
  const journeyId = syntheticUuid();
  await connection().query(
    `insert into journeys (id, walker_id, device_id, state, started_at, last_heartbeat_at)
     values ($1, $2, $3, 'ACTIVE', now() - interval '26 hours', now() - interval '25 hours')`,
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

/** As `lost`, its first responder, R1, on it through the API: the alert ACKNOWLEDGED by R1. */
async function acknowledged({ responders = 3 }: { responders?: number } = {}) {
  const journey = await lost({ responders });
  const [r1] = journey.responders as [Person, ...Person[]];
  const answer = await acknowledge(realApi(), r1.credential, journey.alertId);
  expect({ status: answer.status, body: answer.body }, 'R1 on it').toEqual({
    status: 200,
    body: ON_IT,
  });
  return { ...journey, r1, others: journey.responders.slice(1) };
}

/** Moves the alert's opened_at to `ms` before the database's now(). */
async function openedAgo(alertId: string, ms: number): Promise<void> {
  await connection().query(
    `update alerts set opened_at = now() - ($2::double precision * interval '1 millisecond')
      where id = $1`,
    [alertId, ms],
  );
}

/** A moment as milliseconds since the epoch, in SQL, floored as a Date floors it. */
const MS = (column: string) => `floor(extract(epoch from ${column}) * 1000)::bigint::text`;

async function databaseNowMs(): Promise<number> {
  const result = await connection().query<{ ms: string }>(`select ${MS('now()')} as ms`);
  return Number(result.rows[0]?.ms);
}

/** The database's now(), as PostgreSQL prints it, to the microsecond. */
async function databaseNowText(): Promise<string> {
  const result = await connection().query<{ now: string }>('select now()::text as now');
  return result.rows[0]?.now ?? '';
}

const numberOrNull = (ms: string | null | undefined): number | null =>
  ms === null || ms === undefined ? null : Number(ms);

/** The journey as the table holds it: its state, and when and why it ended, to the microsecond. */
async function journeyOf(journeyId: string) {
  const result = await connection().query<{
    state: string;
    ended_text: string | null;
    end_reason: string | null;
    xmin: string;
  }>(
    `select state::text as state, ended_at::text as ended_text, end_reason::text as end_reason,
            xmin::text as xmin
       from journeys where id = $1`,
    [journeyId],
  );
  const row = result.rows[0];
  return {
    state: row?.state ?? null,
    endedAt: row?.ended_text ?? null,
    endReason: row?.end_reason ?? null,
    xmin: row?.xmin ?? null,
  };
}

/** The journey's alerts, as the table holds them, times to the microsecond. */
async function alertsOf(journeyId: string) {
  const result = await connection().query<{
    id: string;
    state: string;
    opened_text: string;
    resolved_text: string | null;
    resolution: string | null;
    acknowledged_by: string | null;
    round: number;
    xmin: string;
  }>(
    `select id::text as id, state::text as state, opened_at::text as opened_text,
            resolved_at::text as resolved_text, resolution::text as resolution,
            acknowledged_by::text as acknowledged_by, round::int as round, xmin::text as xmin
       from alerts where journey_id = $1 order by opened_at, id`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    state: row.state,
    openedAt: row.opened_text,
    resolvedAt: row.resolved_text,
    resolution: row.resolution,
    acknowledgedBy: row.acknowledged_by,
    round: row.round,
    xmin: row.xmin,
  }));
}

/** The journey's alerts' messages, as the table holds them, times to the microsecond. */
async function messagesOf(journeyId: string) {
  const result = await connection().query<{
    message_id: string;
    recipient_id: string;
    kind: string;
    round: number;
    attempts: number;
    created_text: string;
    next_text: string;
    sent_ms: string | null;
    withdrawn_text: string | null;
    last_failure: string | null;
    xmin: string;
  }>(
    `select o.id::text as message_id, o.recipient_id::text as recipient_id,
            o.kind::text as kind, o.round::int as round, o.attempts::int as attempts,
            o.created_at::text as created_text, o.next_attempt_at::text as next_text,
            ${MS('o.sent_at')} as sent_ms, o.withdrawn_at::text as withdrawn_text,
            o.last_failure::text as last_failure, o.xmin::text as xmin
       from outbox o join alerts a on a.id = o.alert_id
      where a.journey_id = $1 order by o.recipient_id, o.kind, o.round`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    messageId: row.message_id,
    recipientId: row.recipient_id,
    kind: row.kind,
    round: row.round,
    attempts: row.attempts,
    createdAt: row.created_text,
    nextAttemptAt: row.next_text,
    sentAt: numberOrNull(row.sent_ms),
    withdrawnAt: row.withdrawn_text,
    lastFailure: row.last_failure,
    xmin: row.xmin,
  }));
}

/** Everything the tables hold of a journey, its alerts and their messages, to compare before and after. */
async function recordOf(journeyId: string) {
  return {
    journey: await journeyOf(journeyId),
    alerts: await alertsOf(journeyId),
    messages: await messagesOf(journeyId),
    responders: (
      await connection().query<{ responder_id: string }>(
        `select responder_id::text as responder_id from journey_responders
          where journey_id = $1 order by responder_id`,
        [journeyId],
      )
    ).rows.map((row) => row.responder_id),
  };
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

/** A psql-like session of the test's own, holding the journey's row `for update` in an open transaction, outside every pool. */
async function sessionHolding(journeyId: string) {
  const session = new pg.Client({ connectionString: connectionUri() });
  await session.connect();
  await session.query('begin');
  await session.query('select id from journeys where id = $1 for update', [journeyId]);
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
  const name = `lost08_hold_${table}_${event}`;
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

/** A test-only trigger refusing, with SQLSTATE P0001, one write of the close's or the 24-hour end's. */
function refusing(what: string, table: string, event: string, condition: string) {
  const name = `lost08_refuse_${table}_${event}`;
  return {
    what,
    create: [
      `create function ${name}() returns trigger language plpgsql as $$
         begin
           raise exception 'refused by a test trigger' using errcode = 'P0001';
         end
       $$`,
      `create trigger ${name} before ${event} on ${table} for each row when (${condition})
         execute function ${name}()`,
    ],
    drop: [`drop trigger if exists ${name} on ${table}`, `drop function if exists ${name}()`],
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

function closuresFor({
  database: on = database(),
  log = fakeLog(),
}: { database?: Database; log?: FakeLog } = {}) {
  return createClosureService({ alerts: databaseJourneyStore(on), log });
}

function removalFor({ log = fakeLog() }: { log?: FakeLog } = {}) {
  return createRemovalService({ journeys: store(), log });
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
    closures: closuresFor({ database: on, log }),
  });
}

async function post(
  api: ReturnType<typeof realApi>,
  credential: string,
  route: string,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await api.request(apiPath(route), {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}` },
  });
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

/** "They're safe" through the API (LOST-08). */
const close = (api: ReturnType<typeof realApi>, credential: string, alertId: string) =>
  post(api, credential, `alerts/${alertId}/closure`);

/** "I'm home" through the API (D-110). */
const home = (api: ReturnType<typeof realApi>, credential: string, journeyId: string) =>
  post(api, credential, `journeys/${journeyId}/home`);

const recipientsOf = (messages: readonly { recipientId: string }[]) =>
  messages.map(({ recipientId }) => recipientId).sort();

const ofKind = <T extends { kind: string }>(messages: readonly T[], kind: string): T[] =>
  messages.filter((message) => message.kind === kind);

const idsOf = (people: readonly Person[]) => people.map(({ userId }) => userId).sort();

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

/** The stand-down kinds, one per resolution (D-112). */
const STAND_DOWNS = ['BACK_IN_CONTACT', 'HOME', 'SAFE', 'EXPIRED'];

// ---------------------------------------------------------------------------
// LOST-08-AC8, AC9 and AC17: the 24-hour end, on the real tables.
// ---------------------------------------------------------------------------

describe('LOST-08, SM-06 and REL-01: the 24-hour end, on the real tables', () => {
  test('LOST-08-AC8: ALERT_EXPIRES_AFTER_MS is the 24 hours this file writes out (SM-06)', () => {
    expect(ALERT_EXPIRES_AFTER_MS).toBe(A_DAY);
  });

  test('LOST-08-AC17: the 24 hours are counted by the expiring transaction’s now() against opened_at: an alert opened 24 hours less 1 s before now() is left as it is by the sweep; one opened 24 hours before now() is ended (SM-06, REL-01)', async () => {
    const younger = await acknowledged({ responders: 2 });
    const older = await acknowledged({ responders: 2 });
    await openedAgo(younger.alertId, A_DAY - SECOND);
    await openedAgo(older.alertId, A_DAY);
    const youngerBefore = await recordOf(younger.journeyId);

    expect(await watchdogFor().sweep()).toEqual(QUIET);

    expect(await recordOf(younger.journeyId)).toEqual(youngerBefore);
    expect(await journeyOf(older.journeyId)).toMatchObject({
      state: 'ENDED',
      endReason: 'EXPIRED',
    });
  });

  test('LOST-08-AC8: an alert ACKNOWLEDGED by R1 and opened 24 hours before now(): the sweep ends J, EXPIRED, and resolves A, EXPIRED, at one now(), to the microsecond, in one transaction (xmin), between two readings of now(); one EXPIRED for each responder row, R1’s included, in A’s round, none for W; every unsent message of A withdrawn at that now; the sweep ok, with its beat (SM-06, REL-01)', async () => {
    const { walker, journeyId, alertId, responders } = await acknowledged({ responders: 3 });
    await openedAgo(alertId, A_DAY);
    const before = await messagesOf(journeyId);
    const nowBefore = await databaseNowText();
    const log = fakeLog();

    expect(await watchdogFor({ log }).sweep()).toEqual(QUIET);

    const nowAfter = await databaseNowText();
    const journey = await journeyOf(journeyId);
    const [alert] = await alertsOf(journeyId);
    expect(alert).toMatchObject({ state: 'RESOLVED', resolution: 'EXPIRED', round: 1 });
    expect(journey).toMatchObject({ state: 'ENDED', endReason: 'EXPIRED' });
    const at = alert?.resolvedAt ?? '';
    expect(journey.endedAt).toBe(at);
    const messages = await messagesOf(journeyId);
    const expired = ofKind(messages, 'EXPIRED');
    expect(recipientsOf(expired)).toEqual(idsOf(responders));
    for (const message of expired) {
      expect(message, message.recipientId).toMatchObject({
        round: 1,
        createdAt: at,
        nextAttemptAt: at,
        sentAt: null,
        withdrawnAt: null,
      });
    }
    expect(messages.filter(({ recipientId }) => recipientId === walker.userId)).toEqual([]);
    const withdrawn = messages.filter(
      ({ messageId, withdrawnAt }) =>
        withdrawnAt !== null && before.some((was) => was.messageId === messageId),
    );
    expect(withdrawn.length).toBe(before.filter(({ sentAt }) => sentAt === null).length);
    for (const message of withdrawn) {
      expect(message.withdrawnAt).toBe(at);
    }
    expect(
      new Set([
        journey.xmin,
        alert?.xmin,
        ...expired.map(({ xmin }) => xmin),
        ...withdrawn.map(({ xmin }) => xmin),
      ]),
    ).toEqual(new Set([journey.xmin]));
    const between = await connection().query<{ ok: boolean }>(
      'select $1::timestamptz <= $2::timestamptz and $2::timestamptz <= $3::timestamptz as ok',
      [nowBefore, at, nowAfter],
    );
    expect(between.rows).toEqual([{ ok: true }]);
    expect(await lastBeatMs()).not.toBeNull();
    expect(log.events).toEqual([]);
  });

  test('LOST-08-AC8: a reset alert, in round 2, opened 24 hours before now(): the 24 hours count from its opening, not the reset; the remaining responders are told in round 2 (SM-06, SM-10)', async () => {
    const { journeyId, alertId, r1, others } = await acknowledged({ responders: 3 });
    expect(await removalFor().remove({ journeyId, responderId: r1.userId })).toEqual({
      type: 'removed',
    });
    await openedAgo(alertId, A_DAY);

    expect((await watchdogFor().sweep()).ok).toBe(true);

    expect(await journeyOf(journeyId)).toMatchObject({ state: 'ENDED', endReason: 'EXPIRED' });
    const expired = ofKind(await messagesOf(journeyId), 'EXPIRED');
    expect(recipientsOf(expired)).toEqual(idsOf(others));
    expect(expired.map(({ round }) => round)).toEqual([2, 2]);
  });

  test('LOST-08-AC9: an alert whose journey has no responder row, opened 24 hours before now(), counted unheard: the sweep resolves it EXPIRED and ends J EXPIRED, writing no message; the unheard count is then 0 (SM-06, SM-10, SM-02)', async () => {
    const { journeyId, alertId } = await lost({ responders: 1 });
    await connection().query('delete from journey_responders where journey_id = $1', [journeyId]);
    await connection().query('update outbox set sent_at = now() where alert_id = $1', [alertId]);
    await openedAgo(alertId, A_DAY);
    expect((await store().unheardAlertCount()).count).toBe(1);
    const messagesBefore = await messagesOf(journeyId);

    expect(await watchdogFor().sweep()).toEqual(QUIET);

    expect(await journeyOf(journeyId)).toMatchObject({ state: 'ENDED', endReason: 'EXPIRED' });
    expect((await alertsOf(journeyId))[0]).toMatchObject({
      state: 'RESOLVED',
      resolution: 'EXPIRED',
    });
    expect(await messagesOf(journeyId)).toEqual(messagesBefore);
    expect((await store().unheardAlertCount()).count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC11: the 24-hour end decides under the journey's row.
// ---------------------------------------------------------------------------

/** What holds J's row as the 24-hour end's waiting attempt arrives: its work, held open behind a gate. */
const ROW_HOLDERS = [
  {
    holder: 'a fresh heartbeat',
    condition: "new.resolution::text = 'BACK_IN_CONTACT'",
    resolution: 'BACK_IN_CONTACT',
    state: 'ACTIVE',
  },
  {
    holder: '"I’m home"',
    condition: "new.resolution::text = 'HOME'",
    resolution: 'HOME',
    state: 'ENDED',
  },
  {
    holder: 'R1’s close',
    condition: "new.resolution::text = 'SAFE'",
    resolution: 'SAFE',
    state: 'ENDED',
  },
  {
    holder: 'R3’s removal',
    condition: "new.state = 'ACKNOWLEDGED'",
    resolution: 'EXPIRED',
    state: 'ENDED',
  },
] as const;

describe('LOST-08, SM-06 and SM-09: the 24-hour end decides under the journey’s row, on the real tables', () => {
  test.each(ROW_HOLDERS)(
    'LOST-08-AC11: A 30 s or more past its 24 hours, J’s row held by $holder, held open behind a gate: the sweep skips it, then its waiting attempt waits for the row (pg_stat_activity), and decides as the holder left J: J $state, A resolved $resolution, once; the sweep ok and not stuck (SM-06, SM-09)',
    async ({ holder, condition, resolution, state }) => {
      const { walker, journeyId, alertId, r1, responders } = await acknowledged({ responders: 3 });
      const [, , r3] = responders as [Person, Person, Person];
      await openedAgo(alertId, A_DAY + STUCK_AFTER + MINUTE);
      const tag = 'lost08_ac11_holder';
      const sweepPool = workerPool(tag);
      const log = fakeLog();
      const held = await gate();
      let swept: unknown;
      try {
        // R3's removal leaves the alert as it is, so its trigger holds after
        // the responder row's delete instead.
        const { create, drop } =
          holder === 'R3’s removal'
            ? holdBehind(held.key, 'journey_responders', 'delete', 'true')
            : holdBehind(held.key, 'alerts', 'update', condition);
        await withTrigger(create, drop, async () => {
          const holding: Promise<unknown> =
            holder === 'a fresh heartbeat'
              ? store().recordHeartbeat(await freshHeartbeat(journeyId))
              : holder === '"I’m home"'
                ? home(realApi(), walker.credential, journeyId)
                : holder === 'R1’s close'
                  ? close(realApi(), r1.credential, alertId)
                  : removalFor().remove({ journeyId, responderId: r3.userId });
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
      expect(log.events.filter(({ event }) => event.startsWith('expiry_'))).toEqual([]);
      expect((await journeyOf(journeyId)).state).toBe(state);
      const alerts = await alertsOf(journeyId);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ state: 'RESOLVED', resolution });
      const standDowns = (await messagesOf(journeyId)).filter(({ kind }) =>
        STAND_DOWNS.includes(kind),
      );
      expect(new Set(standDowns.map(({ kind }) => kind))).toEqual(new Set([resolution]));
      const told =
        holder === 'R1’s close'
          ? responders.slice(1)
          : holder === 'R3’s removal'
            ? responders.slice(0, 2)
            : responders;
      expect(recipientsOf(standDowns)).toEqual(idsOf(told));
    },
    30_000,
  );

  test.each(['a fresh heartbeat', '"I’m home"', 'R1’s close', 'R3’s removal'] as const)(
    'LOST-08-AC11: the other order: the sweep’s 24-hour end holding J’s row, held open behind a gate after it resolved A, as %s arrives: that waits for the row, then finds J ENDED, EXPIRED, and changes nothing; one resolution, one end, one set of EXPIRED (SM-06, SM-09, SM-07)',
    async (other) => {
      const { walker, journeyId, alertId, r1, responders } = await acknowledged({ responders: 3 });
      const [, , r3] = responders as [Person, Person, Person];
      await openedAgo(alertId, A_DAY + MINUTE);
      const tag = 'lost08_ac11_other';
      const otherPool = apiPool(tag);
      const held = await gate();
      let result: unknown;
      try {
        const { create, drop } = holdBehind(
          held.key,
          'alerts',
          'update',
          "new.resolution::text = 'EXPIRED'",
        );
        await withTrigger(create, drop, async () => {
          const sweeping = watchdogFor().sweep();
          sweeping.catch(() => undefined);
          try {
            expect(await eventually(someoneAtTheGate)).toBe(true);
            const on = createDatabase(otherPool);
            const arriving: Promise<unknown> =
              other === 'a fresh heartbeat'
                ? databaseJourneyStore(on).recordHeartbeat(await freshHeartbeat(journeyId))
                : other === '"I’m home"'
                  ? home(realApi({ database: on }), walker.credential, journeyId)
                  : other === 'R1’s close'
                    ? close(realApi({ database: on }), r1.credential, alertId)
                    : createRemovalService({
                        journeys: databaseJourneyStore(on),
                        log: fakeLog(),
                      }).remove({
                        journeyId,
                        responderId: r3.userId,
                      });
            arriving.catch(() => undefined);
            expect(await eventually(async () => (await waitingOnALock(tag)) === 1)).toBe(true);

            await held.open();
            expect(await sweeping).toEqual(QUIET);
            result = await bounded(arriving, LOCK_WAIT_LIMIT_MS + MARGIN);
          } finally {
            await held.open();
          }
        });
      } finally {
        await held.end();
        await endTestPool(otherPool);
      }

      if (other === 'a fresh heartbeat') {
        expect(result).toEqual({ outcome: 'ended' });
      } else if (other === '"I’m home"') {
        expect(result).toMatchObject({ status: 409, body: { code: 'JOURNEY_ENDED' } });
      } else if (other === 'R1’s close') {
        expect(result).toMatchObject({ status: 409, body: { code: 'ALERT_RESOLVED' } });
      } else {
        expect(result).toEqual({ type: 'ignored', reason: 'JOURNEY_ENDED' });
      }
      expect(await journeyOf(journeyId)).toMatchObject({ state: 'ENDED', endReason: 'EXPIRED' });
      expect(await alertsOf(journeyId)).toMatchObject([
        { state: 'RESOLVED', resolution: 'EXPIRED', acknowledgedBy: r1.userId },
      ]);
      const standDowns = (await messagesOf(journeyId)).filter(({ kind }) =>
        STAND_DOWNS.includes(kind),
      );
      expect(standDowns.map(({ kind }) => kind)).toEqual(['EXPIRED', 'EXPIRED', 'EXPIRED']);
      expect(recipientsOf(standDowns)).toEqual(idsOf(responders));
    },
    30_000,
  );

  test('LOST-08-AC11: A 30 s or more past its 24 hours, J’s row held by a session that never lets go: the sweep’s waiting attempt waits for the row (pg_stat_activity), at least LOCK_WAIT_LIMIT_MS and less than it plus a margin; one expiry_overdue line names A, the sweep fails, counting it stuck, and records no beat; once the hold ends the next sweep ends J (SM-06, REL-08)', async () => {
    const { journeyId, alertId } = await acknowledged({ responders: 2 });
    await openedAgo(alertId, A_DAY + STUCK_AFTER + MINUTE);
    const tag = 'lost08_ac11_stuck';
    const sweepPool = workerPool(tag);
    const log = fakeLog();
    const beatBefore = await lastBeatMs();
    const holder = await sessionHolding(journeyId);
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
    expect(log.events).toEqual([{ event: 'expiry_overdue', alertId }]);
    expect(await lastBeatMs()).toBe(beatBefore);
    expect((await journeyOf(journeyId)).state).toBe('LOST_CONTACT');

    expect(await watchdogFor({ log }).sweep()).toEqual(QUIET);
    expect(await journeyOf(journeyId)).toMatchObject({ state: 'ENDED', endReason: 'EXPIRED' });
  }, 30_000);
});

// ---------------------------------------------------------------------------
// LOST-08-AC16: all or nothing, and loud.
// ---------------------------------------------------------------------------

const REFUSALS = [
  refusing('the journey’s end', 'journeys', 'update', "new.end_reason::text = 'EXPIRED'"),
  refusing('the alert’s resolution', 'alerts', 'update', "new.resolution::text = 'EXPIRED'"),
  refusing('a withdrawal', 'outbox', 'update', 'new.withdrawn_at is not null'),
  refusing('a stand-down', 'outbox', 'insert', "new.kind::text = 'EXPIRED'"),
];

describe('LOST-08 and SM-06: the 24-hour end is all or nothing, and a failure is loud, on the real tables', () => {
  test.each(REFUSALS)(
    'LOST-08-AC16: with a test trigger refusing $what, the sweep fails with one expiry_failed line, stage expire, SQLSTATE P0001, and records no beat; J, A and every message as they were; without the trigger, the next sweep does all of its work (SM-06)',
    async ({ create, drop }) => {
      const { journeyId, alertId, responders } = await acknowledged({ responders: 3 });
      await openedAgo(alertId, A_DAY);
      const before = await recordOf(journeyId);
      const beatBefore = await lastBeatMs();
      const log = fakeLog();

      await withTrigger(create, drop, async () => {
        expect(await watchdogFor({ log }).sweep()).toEqual({ ...QUIET, ok: false });
      });

      expect(log.events).toEqual([{ event: 'expiry_failed', stage: 'expire', code: 'P0001' }]);
      expect(await lastBeatMs()).toBe(beatBefore);
      expect(await recordOf(journeyId)).toEqual(before);
      expect(await watchdogFor().sweep()).toEqual(QUIET);
      expect(await journeyOf(journeyId)).toMatchObject({ state: 'ENDED', endReason: 'EXPIRED' });
      expect(recipientsOf(ofKind(await messagesOf(journeyId), 'EXPIRED'))).toEqual(
        idsOf(responders),
      );
    },
  );
});
